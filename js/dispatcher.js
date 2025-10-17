import { startTutorial } from './tutorial.js';
import { generateDummyData, getDummyOverrides, saveDummyOverrides, clearDummyStorage } from './dummyData.js';
import {
    DRIVER_DATA_URL,
    MILEAGE_DATA_URL,
    ALL_SAFETY_DATA_URL,
    DAYS_TAKEN_HISTORY_URL,
    DISPATCHER_OVERRIDES_URL
} from './config.js';

// --- STATE MANAGEMENT ---
let allDriverData = {};
let allPayDates = [];
let savedOverrides = {};
let currentOverrides = {};
let selectedDriverName = null;
let isTutorialMode = false;

// --- DOM ELEMENTS ---
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const progressBar = document.getElementById('progress-bar');
const mainContent = document.getElementById('main-content');
const searchInput = document.getElementById('dispatcher-driver-search');
const payDateSelect = document.getElementById('pay-date-select');
const driverListContainer = document.getElementById('driver-list-container');
const activityArea = document.getElementById('activity-confirmation-area');
const saveFooter = document.getElementById('save-footer');
const actionButton = document.getElementById('action-btn');
const editButton = document.getElementById('edit-btn');
const cancelButton = document.getElementById('cancel-btn');
const verifiedMessage = document.getElementById('verified-message');
const toastContainer = document.getElementById('toast-container');


// --- UI FUNCTIONS ---
function updateButtonState() {
    const hasChanges = Object.keys(currentOverrides).length > 0;
    if (hasChanges) {
        actionButton.textContent = 'Save Changes & Confirm';
        actionButton.className = 'bg-blue-600 hover:bg-blue-500 focus:ring-blue-500 text-white font-bold py-2 px-6 rounded-lg transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900';
    } else {
        actionButton.textContent = 'Confirm as Correct';
        actionButton.className = 'bg-green-600 hover:bg-green-500 focus:ring-green-500 text-white font-bold py-2 px-6 rounded-lg transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900';
    }
}

async function fetchData(url, resourceName) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Network response for ${resourceName} was not ok.`);
        return (await response.json()).data || [];
    } catch (error) {
        console.error(`Failed to fetch ${resourceName}:`, error);
        showToast(`Error loading ${resourceName}. Please refresh.`, 'error');
        return [];
    }
}

function processAllData(driverList, mileageData, samsaraData, changelogData) {
    const drivers = {};
    const payDates = new Set();
    const formatDate = date => date ? new Date(date).toISOString().split('T')[0] : null;

    driverList.forEach(row => {
        if (row.contract_type !== 'TPOG') return;
        const driverName = row.driver_name;
        if (!driverName) return;
        drivers[driverName] = { name: driverName, dispatcher: row.dispatch, activity: {} };
        const payDate = formatDate(row.pay_date);
        if (payDate) payDates.add(payDate);
    });
    allPayDates = Array.from(payDates).sort().reverse();

    [...mileageData, ...samsaraData, ...changelogData].forEach(item => {
        const name = item.driver_name || item.name;
        const date = formatDate(item.date);
        if (!name || !date || !drivers[name]) return;
        if (!drivers[name].activity[date]) {
            drivers[name].activity[date] = { date, prologMiles: 0, systemStatus: 'NO DATA' };
        }
        const day = drivers[name].activity[date];
        if (item.movement) day.prologMiles += item.movement;
        if (item.activity_status) {
            day.systemStatus = (day.systemStatus === 'NO DATA' ? '' : day.systemStatus + ', ') + item.activity_status.replace(/_/g, ' ');
        }
    });
    // Add a grey color for NO DATA status
    Object.values(drivers).forEach(driver => {
        Object.values(driver.activity).forEach(day => {
            if (day.systemStatus === 'NO DATA') {
                day.colorClass = 'activity-grey';
            }
        });
    });
    return drivers;
}

function renderDriverList() {
    const searchTerm = searchInput.value.toLowerCase();
    if (!searchTerm) {
        driverListContainer.innerHTML = `<p class="text-center text-sm text-slate-500 py-4">Enter a name to see drivers.</p>`;
        return;
    }
    const filteredDrivers = Object.values(allDriverData)
    .filter(d => {
        if (currentUser && currentUser.role && currentUser.role.trim() !== 'Admin') {
            const userAccessList = String(currentUser.access || '').split(',').map(item => item.trim());
            const userRole = currentUser.role.trim();
            let hasAccess = false;
            if (userRole === 'Dispatcher' && userAccessList.includes(d.dispatcher)) hasAccess = true;
            else if (userRole === 'Team Lead' && userAccessList.includes(d.team)) hasAccess = true;
            if (!hasAccess) return false;
        }
        return (d.dispatcher && d.dispatcher.toLowerCase().includes(searchTerm)) || d.name.toLowerCase().includes(searchTerm);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

    if (filteredDrivers.length === 0) {
        driverListContainer.innerHTML = `<p class="text-center text-sm text-slate-500 py-4">No TPOG drivers found.</p>`;
        return;
    }

    const selectedDateStr = payDateSelect.value;
    const monday = new Date(selectedDateStr + 'T12:00:00Z');
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);

    driverListContainer.innerHTML = filteredDrivers.map(driver => {
        const isWeekConfirmed = Array.from({ length: 7 }).every((_, i) => {
            const day = new Date(monday);
            day.setUTCDate(monday.getUTCDate() - i);
            return !!savedOverrides[`${driver.name}_${day.toISOString().split('T')[0]}`];
        });
        return `
            <div class="driver-list-item flex justify-between items-center p-2 rounded-md cursor-pointer hover:bg-slate-700 transition-colors ${selectedDriverName === driver.name ? 'active' : ''}" data-driver-name="${driver.name}">
                <span class="font-medium text-sm">${driver.name}</span>
                ${isWeekConfirmed ? `<div title="Reviewed"><svg class="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg></div>` : ''}
            </div>`;
    }).join('');

    driverListContainer.querySelectorAll('.driver-list-item').forEach(item => {
        item.addEventListener('click', () => selectDriver(item.dataset.driverName));
    });
}

function renderActivityView() {
    currentOverrides = {};
    const driver = allDriverData[selectedDriverName];
    const selectedDateStr = payDateSelect.value;
    const monday = new Date(selectedDateStr + 'T12:00:00Z');
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const tuesday = new Date(monday);
    tuesday.setUTCDate(monday.getUTCDate() - 6);

    const isWeekVerified = Array.from({ length: 7 }).every((_, i) => {
        const day = new Date(tuesday);
        day.setUTCDate(tuesday.getUTCDate() + i);
        return !!savedOverrides[`${driver.name}_${day.toISOString().split('T')[0]}`];
    });

    const statusOptions = ['CORRECT', 'DAY_OFF', 'ACTIVE', 'WITHOUT_LOAD', 'NOT_STARTED', 'CONTRACT_ENDED'];
    let weekHtml = `
        <div>
            <h2 class="text-xl font-semibold text-white mb-4">Confirm Activity for ${selectedDriverName}</h2>
            <div class="grid grid-cols-7 gap-3">`;

    for (let i = 0; i < 7; i++) {
        const currentDay = new Date(tuesday);
        currentDay.setUTCDate(tuesday.getUTCDate() + i);
        const dayString = currentDay.toISOString().split('T')[0];
        const dayData = driver.activity[dayString] || { prologMiles: 0, systemStatus: 'NO DATA' };
        const savedStatus = savedOverrides[`${selectedDriverName}_${dayString}`];
        const cardClass = savedStatus && savedStatus !== 'CORRECT' ? 'status-confirmed' : 'border-slate-700';

        weekHtml += `
            <div id="day-card-${dayString}" class="day-card bg-slate-800 border-2 ${cardClass} rounded-lg p-4 shadow-xl shadow-black/20 hover:ring-2 hover:ring-blue-500 transition-all flex flex-col">
                <div class="flex-grow">
                    <p class="font-bold text-white text-center">${currentDay.toLocaleDateString(undefined, { weekday: 'long' })}</p>
                    <p class="text-sm text-slate-400 text-center">${dayString}</p>
                    <div class="mt-4 space-y-1 text-sm">
                        <p class="min-h-[40px]"><span class="font-semibold text-slate-400">Status:</span> <span class="text-blue-400 font-medium">${dayData.systemStatus}</span></p>
                        <p><span class="font-semibold text-slate-400">Miles:</span> ${Math.round(dayData.prologMiles)} mi</p>
                    </div>
                </div>
                <div class="mt-4 flex-shrink-0">
                    <label class="text-xs font-medium text-slate-400">Confirmation</label>
                    <select data-date="${dayString}" class="status-select w-full mt-1 py-1 px-2 border border-slate-600 bg-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" ${isWeekVerified ? 'disabled' : ''}>
                        ${statusOptions.map(opt => `<option value="${opt}" ${savedStatus === opt ? 'selected' : ''}>${opt.replace(/_/g, ' ')}</option>`).join('')}
                    </select>
                </div>
            </div>`;
    }
    weekHtml += `</div></div>`;
    activityArea.innerHTML = weekHtml;
    
    if (isWeekVerified) {
        actionButton.classList.add('hidden');
        cancelButton.classList.add('hidden');
        verifiedMessage.classList.remove('hidden');
        editButton.classList.remove('hidden');
    } else {
        actionButton.classList.remove('hidden');
        cancelButton.classList.add('hidden');
        verifiedMessage.classList.add('hidden');
        editButton.classList.add('hidden');
        updateButtonState();
    }
    saveFooter.classList.remove('hidden');
}

async function saveOverrides(overridesToSave) {
    actionButton.disabled = true;
    actionButton.textContent = 'Saving...';
    editButton.disabled = true;

    if (isTutorialMode) {
        saveDummyOverrides(overridesToSave);
        showToast('Confirmation saved in tutorial mode!', 'success');
        savedOverrides = getDummyOverrides();
        currentOverrides = {};
        renderDriverList();
        renderActivityView();
        actionButton.disabled = false;
        editButton.disabled = false;
        return;
    }
    
    try {
        await fetch(DISPATCHER_OVERRIDES_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ overrides: overridesToSave })
        });
        showToast('Confirmation saved successfully!', 'success');
        overridesToSave.forEach(ov => {
            savedOverrides[`${ov.driverName}_${ov.date}`] = ov.status;
        });
        currentOverrides = {};
        renderDriverList();
        renderActivityView();
    } catch (error) {
        console.error('Save failed:', error);
        showToast('Failed to save changes. Check console for details.', 'error');
        updateButtonState();
    } finally {
        actionButton.disabled = false;
        editButton.disabled = false;
    }
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `p-4 rounded-lg shadow-xl text-white text-sm bg-${type === 'success' ? 'green' : 'red'}-600`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function selectDriver(name) {
    selectedDriverName = name;
    renderDriverList();
    renderActivityView();
}

async function init(forceTutorial = false) {
    const tutorialSeen = localStorage.getItem('dispatcherTutorialSeen');
    isTutorialMode = forceTutorial || !tutorialSeen;

    mainContent.classList.add('hidden');
    loadingOverlay.style.opacity = '1';
    loadingOverlay.style.pointerEvents = 'auto';

    const updateTotalProgress = (percent, text) => {
        progressBar.style.width = `${percent}%`;
        loadingText.textContent = text;
    };

    if (isTutorialMode) {
        updateTotalProgress(50, 'Loading tutorial data...');
        const dummy = generateDummyData();
        allDriverData = dummy.allDriverData;
        allPayDates = dummy.allPayDates;
        savedOverrides = getDummyOverrides();
        updateTotalProgress(100, 'Ready.');
    } else {
        clearDummyStorage();
        updateTotalProgress(10, 'Loading saved overrides...');
        const savedOverridesData = await fetchData(DISPATCHER_OVERRIDES_URL, 'Dispatcher Overrides');
        savedOverrides = savedOverridesData.reduce((acc, row) => {
            acc[`${row['Driver Name']}_${row['Date']}`] = row['Confirmed Status'];
            return acc;
        }, {});
        
        updateTotalProgress(30, 'Loading driver data...');
        const driverList = await fetchData(DRIVER_DATA_URL, 'Driver List');
        updateTotalProgress(50, 'Loading mileage data...');
        const mileageData = await fetchData(MILEAGE_DATA_URL, 'Mileage Data');
        updateTotalProgress(70, 'Loading Samsara data...');
        const samsaraData = await fetchData(ALL_SAFETY_DATA_URL, 'Samsara Data');
        updateTotalProgress(85, 'Loading activity logs...');
        const changelogData = await fetchData(DAYS_TAKEN_HISTORY_URL, 'Activity Logs');
        updateTotalProgress(95, 'Processing data...');
        allDriverData = processAllData(driverList, mileageData, samsaraData, changelogData);
    }
    
    payDateSelect.innerHTML = allPayDates.map(date => `<option value="${date}">${date}</option>`).join('');
    payDateSelect.disabled = false;

    // --- EVENT LISTENERS ---
    searchInput.addEventListener('input', renderDriverList);
    payDateSelect.addEventListener('change', () => {
        selectedDriverName = null;
        activityArea.innerHTML = '<p class="text-slate-500">Select a driver from the list to begin confirmation.</p>';
        saveFooter.classList.add('hidden');
        renderDriverList();
    });
    
    activityArea.addEventListener('change', e => {
        if (e.target.classList.contains('status-select')) {
            const date = e.target.dataset.date;
            const status = e.target.value;
            const card = document.getElementById(`day-card-${date}`);
            const key = `${selectedDriverName}_${date}`;
            const originalStatus = savedOverrides[key] || 'CORRECT';

            if (status === originalStatus) {
                delete currentOverrides[date];
                card.classList.remove('status-override');
            } else {
                currentOverrides[date] = status;
                card.classList.add('status-override');
                card.classList.remove('status-confirmed');
            }
            updateButtonState();
        }
    });

    actionButton.addEventListener('click', () => {
        const weekDays = [...activityArea.querySelectorAll('.day-card')].map(card => card.id.replace('day-card-', ''));
        const hasChanges = Object.keys(currentOverrides).length > 0;
        
        const overrides = weekDays.map(date => {
            let status = 'CORRECT';
            if(hasChanges) {
                const key = `${selectedDriverName}_${date}`;
                status = currentOverrides[date] || savedOverrides[key] || 'CORRECT';
            }
            return { date, driverName: selectedDriverName, status };
        });
        saveOverrides(overrides);
    });

    editButton.addEventListener('click', () => {
        activityArea.querySelectorAll('.status-select').forEach(sel => sel.disabled = false);
        actionButton.classList.remove('hidden');
        cancelButton.classList.remove('hidden');
        verifiedMessage.classList.add('hidden');
        editButton.classList.add('hidden');
        updateButtonState();
    });

    cancelButton.addEventListener('click', () => {
        currentOverrides = {};
        renderActivityView();
    });
    
    document.getElementById('start-tutorial-btn').addEventListener('click', () => {
        init(true); // Re-initialize in tutorial mode
    });
    
    setTimeout(() => {
        loadingOverlay.style.opacity = '0';
        loadingOverlay.style.pointerEvents = 'none';
        mainContent.classList.remove('hidden');

        if (isTutorialMode) {
            startTutorial(() => init(false)); // On tutorial end, init with live data
        }
    }, 500);
}

// Initial Load
init();