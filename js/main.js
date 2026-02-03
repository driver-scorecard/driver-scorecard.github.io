/**
 * main.js
 * * The entry point and controller for the application.
 * It initializes the app, manages state, and wires up all event listeners.
 */
import * as config from './config.js';
import * as api from './api.js';
import { supabase } from './api.js'; // <-- ADD THIS LINE
import { getCachedFuelHistory, getCachedPurchaseHistory } from './api.js';
import { runTruckFuelAnalysis } from './fuelTankAnalysis.js';
import * as calc from './calculations.js';
import * as ui from './ui.js'; 
import { showCustomAlert, showCustomConfirm } from './ui.js';
import { startTutorial } from './tutorial.js';
import { generateDummyData, getDummyOverrides, saveDummyOverrides, clearDummyStorage } from './dummyData.js';

// --- PERFORMANCE LOGGING HELPER ---
async function logPerformance(label, promise) {
    console.log(`[Loading] Starting: ${label}...`);
    const startTime = performance.now();
    try {
        const result = await promise;
        const endTime = performance.now();
        console.log(`[Loading] Finished: ${label} in ${((endTime - startTime) / 1000).toFixed(2)}s`);
        return result;
    } catch (error) {
        console.error(`[Loading] FAILED: ${label}`, error);
        // Re-throw the error so Promise.all will reject if any fetch fails
        throw error;
    }
}

// --- STATE MANAGEMENT ---
const CORRECT_PIN = '7777';
let processedDriversForDate = []; // Cache for processed driver data
let currentEditingUserEmail = null;
let currentUser = null;
let sessionToken = null;
let dataLoadingPromise = null;
let settings = {};
let allDrivers = [];
let mileageData = [];
let mileageIndex = {}; // <-- NEW
let allSafetyData = [];
let safetyIndex = {};  // <-- NEW
let financialData = [];
let driversForDate = [];
let daysTakenIndex = {}; // <-- NEW
let availableContractTypes = [];
let orderedColumnKeys = Object.keys(config.columnConfig);
const defaultHiddenColumns = ['dispatcher', 'team', 'rpm', 'speeding_over11mph', 'speeding_over16mph', 'franchise', 'company', 'pay_delayWks', 'stubMiles', 'estimatedNet', 'speedingPercentile', 'driver_rep'];
let visibleColumnKeys = Object.keys(config.columnConfig).filter(key => !defaultHiddenColumns.includes(key));
let pinnedColumns = { left: ['name'], right: ['totalTpog', 'bonuses', 'penalties', 'escrowDeduct', 'actions'] };
let activeRowFilter = 'none';
let currentEditingDriverId = null;
let draggedColumnKey = null;
let overriddenDistances = {};
let daysTakenHistory = [];
let dispatcherOverrides = {};
let mpgOverrides = {}; // <-- NEW
let savedOverrides = [];
let allWeeklyNotes = {};
let allLockedData = {};

// --- DOM ELEMENT REFERENCES ---
const searchInput = document.getElementById('search-input');
const globalTooltip = document.getElementById('global-tooltip');
const rowFilterBtn = document.getElementById('row-filter-btn');
const rowFilterOptions = document.getElementById('row-filter-options');
const rowFilterIcon = document.getElementById('row-filter-icon');
const payDateSelect = document.getElementById('pay-date-select');
const generalFilterBtn = document.getElementById('general-filter-btn');
const generalFilterPanel = document.getElementById('general-filter-panel');
const addFilterBtn = document.getElementById('add-filter-btn');
const removeAllFiltersBtn = document.getElementById('remove-all-filters-btn');
const filterRowsContainer = document.getElementById('filter-rows-container');
const columnToggleBtn = document.getElementById('column-toggle-btn');
const columnToggleOptions = document.getElementById('column-toggle-options');
const tableHead = document.getElementById('main-table-head');
const tableBody = document.getElementById('driver-table-body');
const settingsContent = document.getElementById('settings-content');
const tooltipHandler = (e, container) => {
    container.addEventListener('mouseover', e => {
        const tooltipContainer = e.target.closest('.tooltip-container');
        if (!tooltipContainer) return;
        let content = '';
        if (tooltipContainer.dataset.tooltipType === 'breakdown') {
            const title = tooltipContainer.dataset.tooltipTitle;
            const breakdown = tooltipContainer.dataset.tooltipBreakdown.split('|');
            content = `<div class="p-1"><div class="font-bold text-base mb-2 text-slate-100">${title}</div><ul class="space-y-1">${breakdown.map(item => `<li class="text-xs whitespace-nowrap">${item}</li>`).join('')}</ul></div>`;
        } else {
            content = tooltipContainer.dataset.tooltip || '';
        }
        if (content) {
            globalTooltip.innerHTML = content;
            globalTooltip.classList.remove('hidden');
            const rect = tooltipContainer.getBoundingClientRect();
            const tooltipRect = globalTooltip.getBoundingClientRect();
            let top = rect.bottom + 8;
            if (window.innerHeight - rect.bottom < tooltipRect.height + 15) top = rect.top - tooltipRect.height - 8;
            globalTooltip.style.left = `${rect.left + rect.width / 2 - tooltipRect.width / 2}px`;
            globalTooltip.style.top = `${top}px`;
        }
    });
    container.addEventListener('mouseout', e => {
        if (e.target.closest('.tooltip-container')) globalTooltip.classList.add('hidden');
    });
};

function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

function filterAndRenderTable() {
    // Note: This function no longer runs the slow processDriverDataForDate calculation.
    // It now uses the pre-calculated 'processedDriversForDate' array.

    const searchTerm = searchInput.value.toLowerCase();
    const filterLogic = document.querySelector('input[name="filter-logic"]:checked')?.value || 'AND';

    const filterRules = [];
    document.querySelectorAll('.filter-row').forEach(row => {
        const column = row.querySelector('.filter-column').value;
        const operator = row.querySelector('.filter-operator').value;
        const valueElement = row.querySelector('.filter-value');
        let value = [];

        if (valueElement) {
            if (valueElement.tagName.toLowerCase() === 'select') {
                value = valueElement.multiple 
                    ? [...valueElement.options].filter(opt => opt.selected).map(opt => opt.value)
                    : (valueElement.value ? [valueElement.value] : []);
            } else if (valueElement.value) {
                if (operator === 'is_any_of' || operator === 'is_not_any_of') {
                    value = valueElement.value.split(',').map(v => v.trim()).filter(Boolean);
                } else {
                    value = [valueElement.value];
                }
            }
        }
        if (column && operator) {
            filterRules.push({ column, operator, value });
        }
    });

    const evaluateRule = (driver, rule) => {
        const { column, operator, value } = rule;
        const driverValue = driver[column];
        const normalizedDriverValue = String(driverValue || '').toLowerCase();

        if ((operator !== 'is_empty' && operator !== 'is_not_empty') && value.length === 0) {
            return true;
        }

        switch (operator) {
            case 'is': return normalizedDriverValue === (value[0] || '').toLowerCase();
            case 'is_not': return normalizedDriverValue !== (value[0] || '').toLowerCase();
            case 'contains': return normalizedDriverValue.includes((value[0] || '').toLowerCase());
            case 'does_not_contain': return !normalizedDriverValue.includes((value[0] || '').toLowerCase());
            case 'starts_with': return normalizedDriverValue.startsWith((value[0] || '').toLowerCase());
            case 'ends_with': return normalizedDriverValue.endsWith((value[0] || '').toLowerCase());
            case 'is_any_of': return value.map(v => v.toLowerCase()).includes(normalizedDriverValue);
            case 'is_not_any_of': return !value.map(v => v.toLowerCase()).includes(normalizedDriverValue);
            case 'is_empty': return driverValue === '' || driverValue === null || typeof driverValue === 'undefined' || driverValue === 0;
            case 'is_not_empty': return !(driverValue === '' || driverValue === null || typeof driverValue === 'undefined' || driverValue === 0);
            default: return true;
        }
    };

    // All filtering logic now runs on the 'processedDriversForDate' array.
    let filteredDrivers = processedDriversForDate.filter(d => {
        if (currentUser && currentUser.role && currentUser.role.trim() !== 'Admin') {
            const userAccessList = String(currentUser.access || '').split(',').map(item => item.trim());
            const userRole = currentUser.role.trim();
            let hasAccess = false;
            if (userRole === 'Dispatcher' && userAccessList.includes(d.dispatcher)) hasAccess = true;
            else if (userRole === 'Team' && userAccessList.includes(d.team)) hasAccess = true;
            else if (userRole === 'Franchise' && userAccessList.includes(d.franchise)) hasAccess = true;
            else if (userRole === 'Driver Rep' && userAccessList.includes(d.driver_rep) && d.contract_type === 'TPOG') hasAccess = true;
            else if (userRole === 'Marketing' && userAccessList.includes(d.name)) hasAccess = true;
            if (!hasAccess) return false;
        }
        
        const matchesSearch = (d.name || '').toLowerCase().startsWith(searchTerm);
        if (!matchesSearch) return false;

        if (filterRules.length > 0) {
            const passesAdvancedFilters = (filterLogic === 'AND')
                ? filterRules.every(rule => evaluateRule(d, rule))
                : filterRules.some(rule => evaluateRule(d, rule));
            if (!passesAdvancedFilters) return false;
        }
        
        return true;
    });

    if (activeRowFilter !== 'none') {
        filteredDrivers = filteredDrivers.filter(driver => {
            const hasSamsara = (driver.samsaraDistance || 0) > 0;
            const hasPrologs = (driver.milesWeek || 0) > 0;
            switch (activeRowFilter) {
                case 'zero-rows':
                    return (parseFloat(driver.safetyScore) || 0) !== 0 || (parseInt(driver.speedingAlerts, 10) || 0) !== 0 || (parseInt(driver.weeksOut, 10) || 0) !== 0 || (parseFloat(driver.milesWeek) || 0) !== 0 || (parseFloat(driver.mpg) || 0) !== 0 || (parseInt(driver.tenure, 10) || 0) !== 0;
                case 'no-samsara': return hasSamsara;
                case 'no-prologs': return hasPrologs;
                case 'no-samsara-or-prologs': return hasSamsara || hasPrologs;
                case 'no-samsara-and-prologs': return hasSamsara && hasPrologs;
                default: return true;
            }
        });
    }

    // Filter for Locked Data (Driver Reps & Franchise)
    if (currentUser && (currentUser.role.trim() === 'Driver Rep' || currentUser.role.trim() === 'Franchise')) {
        filteredDrivers = filteredDrivers.filter(driver => driver.isLocked === true);
    }

    filteredDrivers.sort((a, b) => {
        if (a.contract_type === 'TPOG' && b.contract_type !== 'TPOG') return -1;
        if (a.contract_type !== 'TPOG' && b.contract_type === 'TPOG') return 1;
        return 0;
    });

    // Determine columns to show (Restriction removed: Franchise can now see MPG)
    let columnsToShow = visibleColumnKeys;

    ui.renderTable(filteredDrivers, {
        orderedColumnKeys,
        visibleColumnKeys: columnsToShow,
        pinnedColumns,
        settings,
        overriddenDistances
    }, currentUser); // Pass currentUser here
}

function downloadManualReport() {
    const isNew = currentEditingDriverId === null;
    const manualDriverData = { id: isNew ? Date.now() : currentEditingDriverId };
    manualDriverData.pay_date = payDateSelect.value + 'T00:00:00.000Z';
    manualDriverData.name = isNew ? document.getElementById('edit-name').value || "Manual Entry" : driversForDate.find(d => d.id == currentEditingDriverId).name;

    Object.keys(config.columnConfig)
        .filter(k => k !== 'id' && k !== 'name' && k !== 'totalTpog' && k !== 'actions')
        .forEach(key => {
            const input = document.getElementById(`edit-${key}`);
            if (input) {
                if (config.columnConfig[key].type === 'number' || config.columnConfig[key].type === 'percent' || key === 'availableOffDays' || key === 'escrowDeduct') {
                    const parsedValue = parseFloat(input.value);
                    manualDriverData[key] = isNaN(parsedValue) ? 0 : parsedValue;
                } else {
                    manualDriverData[key] = input.value;
                }
            }
    });

    const availableOffDaysInput = document.getElementById('edit-availableOffDays');
    if(availableOffDaysInput) manualDriverData.availableOffDays = parseFloat(availableOffDaysInput.value) || 0;

    const escrowDeductInput = document.getElementById('edit-escrowDeduct');
    if(escrowDeductInput) manualDriverData.escrowDeduct = parseFloat(escrowDeductInput.value) || 0;

    ui.downloadDriverReport(manualDriverData, settings, driversForDate);
    ui.closeEditPanel();
}

/**
 * Generates an HTML string explaining the current settings for the Marketing modal.
 * @param {object} currentSettings The global settings object.
 * @returns {string} An HTML string.
 */
function generateMarketingHelpContent(currentSettings) {
    if (!currentSettings || Object.keys(currentSettings).length === 0) {
        return '<p class="text-orange-400">Could not load current settings.</p>';
    }

    let html = '<div>';

    const formatTiers = (tiers, unit, valueKey = 'bonus') => {
        if (!tiers || tiers.length === 0) return '<li>No tiers configured.</li>';
        return tiers
            .sort((a, b) => a.threshold - b.threshold)
            .map(tier => `<li>+${tier[valueKey]}% for ${tier.threshold}${unit}</li>`)
            .join('');
    };

    const formatRangeTiers = (tiers, unit, valueKey = 'bonus') => {
        if (!tiers || tiers.length === 0) return '<li>No tiers configured.</li>';
        return tiers
            .sort((a, b) => a.from - b.from)
            .map(tier => {
                const value = tier[valueKey] || tier['penalty'] || 0;
                const prefix = value > 0 ? '+' : '';
                const toText = (tier.to === Infinity || !tier.to) ? 'and up' : `to ${tier.to}`;
                return `<li>${prefix}${value}% for ${tier.from} ${toText} ${unit}</li>`;
            })
            .join('');
    };

    // Base Rate
    html += `<div>
                <strong class="text-slate-200">Base Rate:</strong>
                <span class="text-blue-400 font-semibold ml-2">${currentSettings.baseRate || 0}%</span>
             </div>`;

    // Enabled Metrics
    html += '<div><strong class="text-slate-200">Enabled Metrics:</strong><ul>';
    const metrics = currentSettings.enabledMetrics || {};
    html += `<li>Performance (Weeks Out): <span class="${metrics.weeksOut ? 'text-green-400' : 'text-red-400'}">${metrics.weeksOut ? 'ON' : 'OFF'}</span></li>`;
    html += `<li>Safety (Score & Speeding): <span class="${metrics.safety ? 'text-green-400' : 'text-red-400'}">${metrics.safety ? 'ON' : 'OFF'}</span></li>`;
    html += `<li>Fuel Efficiency: <span class="${metrics.fuel ? 'text-green-400' : 'text-red-400'}">${metrics.fuel ? 'ON' : 'OFF'}</span></li>`;
    html += `<li>Tenure: <span class="${metrics.tenure ? 'text-green-400' : 'text-red-400'}">${metrics.tenure ? 'ON' : 'OFF'}</span></li>`;
    html += `<li>Gross Target: <span class="${metrics.grossTarget ? 'text-green-400' : 'text-red-400'}">${metrics.grossTarget ? 'ON' : 'OFF'}</span></li>`;
    html += '</ul></div>';

    // Performance
    if (metrics.weeksOut) {
        html += `<div><strong class="text-slate-200">Performance (Weeks Out) Tiers:</strong><ul>`;
        html += formatTiers(currentSettings.weeksOutTiers, ' weeks');
        html += '</ul></div>';
    }

    // Safety
    if (metrics.safety) {
        html += `<div><strong class="text-slate-200">Safety Score Bonus:</strong><ul>`;
        html += `<li>+${currentSettings.safetyScoreBonus || 0}% for score >= ${currentSettings.safetyScoreThreshold || 0}% (and miles >= ${currentSettings.safetyScoreMileageThreshold || 0})</li>`;
        html += `<li>Bonus forfeited on speeding: <span class="font-semibold ${currentSettings.safetyBonusForfeitedOnSpeeding ? 'text-red-400' : 'text-green-400'}">${currentSettings.safetyBonusForfeitedOnSpeeding ? 'YES' : 'NO'}</span></li>`;
        html += '</ul></div>';
        
        html += `<div><strong class="text-slate-200">Speeding Penalty Method:</strong><ul>`;
        const method = currentSettings.speedingPenaltyMethod || 'percentile';
        switch (method) {
            case 'percentile':
                html += `<li>Using <strong class="text-blue-400">Percentile</strong> Tiers:</li><ul>`;
                html += formatTiers(currentSettings.speedingPercentileTiers, '%-ile');
                html += `</ul>`;
                break;
            case 'perEvent':
                html += `<li>Using <strong class="text-blue-400">Per Event</strong>:</li><ul>`;
                html += `<li>${currentSettings.speedingPerEventPenalty || 0}% for each event after the first ${currentSettings.speedingPerEventMinimum - 1 || 1}</li>`;
                html += `</ul>`;
                break;
            case 'range':
                html += `<li>Using <strong class="text-blue-400">Range</strong> Tiers:</li><ul>`;
                html += formatRangeTiers(currentSettings.speedingRangeTiers, 'events', 'penalty');
                html += `</ul>`;
                break;
        }
        html += '</ul></div>';
    }

    // Fuel
    if (metrics.fuel) {
        html += `<div><strong class="text-slate-200">Fuel Efficiency (MPG) Tiers:</strong><ul>`;
        html += formatTiers(currentSettings.mpgPercentileTiers, '%-ile');
        html += `<li>(Requires at least ${currentSettings.fuelMileageThreshold || 0} miles)</li>`;
        html += '</ul></div>';
    }

    // Tenure
    if (metrics.tenure) {
        html += `<div><strong class="text-slate-200">Tenure Tiers (Cumulative):</strong><ul>`;
        html += formatTiers(currentSettings.tenureMilestones, ' weeks');
        html += '</ul></div>';
    }

    // Gross Target
    if (metrics.grossTarget) {
        html += `<div><strong class="text-slate-200">Gross Target Tiers:</strong><ul>`;
        html += formatRangeTiers(currentSettings.grossTargetTiers, '($)');
        html += '</ul></div>';
    }

    html += '</div>';
    return html;
}


function initializeEventListeners() {
    
    const activityHistoryContent = document.getElementById('activity-history-content');
    const sidebar = document.getElementById('sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');
    const mainAppContainer = document.getElementById('main-app-container');
    const addUserModal = document.getElementById('add-user-modal');
const openAddUserModalBtn = document.getElementById('add-new-user-btn');
const closeAddUserModalBtn = document.getElementById('close-add-user-modal-btn');

document.getElementById('nav-dispatcher').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('dispatcher');
});

openAddUserModalBtn.addEventListener('click', () => openUserModal(false));

closeAddUserModalBtn.addEventListener('click', () => {
    addUserModal.classList.add('hidden');
    addUserModal.classList.remove('flex');
});

addUserModal.addEventListener('click', (e) => {
    if (e.target === addUserModal) {
        addUserModal.classList.add('hidden');
        addUserModal.classList.remove('flex');
    }
});

const userProfilesTableBody = document.getElementById('user-profiles-table-body');
userProfilesTableBody.addEventListener('click', async (e) => {
    const editButton = e.target.closest('button[title="Edit"]');
    const deleteButton = e.target.closest('button[title="Delete"]');
    const userRow = e.target.closest('tr');
    if (!userRow) return;

    const userEmail = userRow.cells[0].textContent;
    const userRole = userRow.cells[1].textContent;
    const userAccess = userRow.cells[2].textContent;

    if (editButton) {
        currentEditingUserEmail = userEmail;
        openUserModal(true, { email: userEmail, role: userRole, access: userAccess });
    }

    if (deleteButton) {
        const confirmed = await showCustomConfirm(
            'Delete User',
            `Are you sure you want to delete the user: ${userEmail}? This action cannot be undone.`,
            { confirmText: 'Delete', isDanger: true }
        );
        if (confirmed) {
            const result = await api.deleteUser(userEmail);
            if (result.status === 'success') {
                showCustomAlert('User deleted successfully!', 'Success');
                loadAndRenderUsers();
            } else {
                showCustomAlert(`Error: ${result.message}`, 'Error');
            }
        }
    }
});

    const debouncedFilterAndRender = debounce(filterAndRenderTable, 300);
    searchInput.addEventListener('input', debouncedFilterAndRender);
    payDateSelect.addEventListener('change', () => {
        ui.showLoadingOverlay();

        // Use setTimeout to allow the browser to render the loading overlay
        // before the heavy processing task blocks the main thread.
        setTimeout(() => {
            processDataForSelectedDate(); // Run the slow calculations.
            filterAndRenderTable();     // Then run the fast filtering and rendering.
            ui.hideLoadingOverlay();    // Hide the overlay once done.
        }, 50); // A small timeout is enough to yield to the browser's event loop.
    });

    rowFilterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rowFilterOptions.classList.toggle('hidden');
    });

    rowFilterOptions.addEventListener('click', (e) => {
        e.preventDefault();
        const clickedOption = e.target.closest('a');
        if (!clickedOption) return;
        const filterType = clickedOption.dataset.filter;
        if (filterType) {
            activeRowFilter = filterType;
            rowFilterOptions.querySelectorAll('a').forEach(opt => opt.classList.remove('active-filter'));
            clickedOption.classList.add('active-filter');
            const eyeIcon = `<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
            const eyeOffIcon = `<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59"/>`;
            rowFilterIcon.innerHTML = (activeRowFilter === 'none') ? eyeOffIcon : eyeIcon;
            filterAndRenderTable();
            rowFilterOptions.classList.add('hidden');
        }
    });
    
    columnToggleBtn.addEventListener('click', () => columnToggleOptions.classList.toggle('hidden'));
    generalFilterBtn.addEventListener('click', () => generalFilterPanel.classList.toggle('hidden'));
    addFilterBtn.addEventListener('click', () => ui.addFilterRow(filterRowsContainer, allDrivers));
    const setDefaultTpogFilter = () => {
        // Clear any existing filters to ensure a clean slate.
        filterRowsContainer.innerHTML = '';
        // Add a new filter row using your existing UI function.
        ui.addFilterRow(filterRowsContainer, allDrivers);
        
        const defaultFilterRow = filterRowsContainer.querySelector('.filter-row');
        if (defaultFilterRow) {
            const columnSelect = defaultFilterRow.querySelector('.filter-column');
            const operatorSelect = defaultFilterRow.querySelector('.filter-operator');
            
            // Programmatically set the filter to: 'Contract Type' -> 'is'
            columnSelect.value = 'contract_type';
            operatorSelect.value = 'is';
            
            // Dispatch a 'change' event. This is crucial to make sure the UI correctly
            // updates the value input field based on the new operator.
            operatorSelect.dispatchEvent(new Event('change', { bubbles: true }));
            
            // Now, set the value of that input field to 'TPOG'.
            const valueInput = defaultFilterRow.querySelector('.filter-value');
            if (valueInput) {
                valueInput.value = 'TPOG';
            }
        }
    };

    // When the app first loads, set the default filter.
    setDefaultTpogFilter();

    // Update the "REMOVE ALL" button to restore the default filter instead of clearing everything.
    removeAllFiltersBtn.addEventListener('click', () => {
        setDefaultTpogFilter();
        filterAndRenderTable(); // Re-render the table with the default filter applied.
    });

    filterRowsContainer.addEventListener('change', e => {
        const target = e.target;
        const filterRow = target.closest('.filter-row'); // <-- FIX 1: Use correct class
        if (!filterRow) return;

        // Check if column or operator changed
        if (target.matches('.filter-column') || target.matches('.filter-operator')) {
            // FIX 2: Call the correct UI function from ui.js
            // It needs the row element and the full driver list
            ui.updateFilterValueField(filterRow, allDrivers); 
        }
        
        // FIX 3: Re-render the *main* table, not the archive table
        debounce(filterAndRenderTable, 300)(); 
    });

    filterRowsContainer.addEventListener('click', e => {
        if (e.target.closest('.remove-filter-btn')) {
            e.target.closest('.filter-row').remove();
            filterAndRenderTable();
        }
    });

    document.getElementById('open-settings-btn').addEventListener('click', () => {
        ui.renderSettingsContent(settings);
        ui.openSettings();
    });
    document.getElementById('create-manual-report-btn').addEventListener('click', () => {
        currentEditingDriverId = null;
        ui.openEditPanel(null, { drivers: driversForDate, allDrivers, settings, driversForDate, overriddenDistances });
    });

    document.querySelectorAll('input[name="filter-logic"]').forEach(radio => radio.addEventListener('change', filterAndRenderTable));

    document.getElementById('close-settings-btn').addEventListener('click', ui.closeSettings);
    document.getElementById('settings-overlay').addEventListener('click', ui.closeSettings);
    
    const pinModal = document.getElementById('pin-modal');
    const pinInput = document.getElementById('pin-input');
    const pinError = document.getElementById('pin-error');
    
    document.getElementById('save-settings-btn').addEventListener('click', () => {
        pinInput.value = '';
        pinError.classList.add('hidden');
        pinModal.classList.remove('hidden');
        pinInput.focus();
    });

    document.getElementById('nav-fuel-tank').addEventListener('click', (e) => {
        e.preventDefault();
        if (currentUser && currentUser.role.trim() === 'Admin') {
            switchView('fuel-tank');
            loadAndRenderFuelTankAnalysis(); // Trigger the analysis
        }
    });

    document.getElementById('pin-cancel-btn').addEventListener('click', () => pinModal.classList.add('hidden'));
    pinModal.addEventListener('click', (e) => { if (e.target === pinModal) pinModal.classList.add('hidden'); });

    document.getElementById('pin-submit-btn').addEventListener('click', async () => {
        if (pinInput.value === CORRECT_PIN) {
            pinModal.classList.add('hidden');
            ui.closeSettings(); // Close the panel immediately for better UX
            ui.showLoadingOverlay(); // Show the loading screen

            // Use setTimeout to allow the UI to update before the heavy work
            setTimeout(async () => {
                const newSettings = calc.updateSettingsFromUI();
                if (newSettings) {
                    settings = newSettings;
                    const btn = document.getElementById('save-settings-btn');
                    btn.disabled = true;
                    btn.innerHTML = 'Saving...';
                    
                    await api.saveSettings(settings);
                    
                    // Fetch the latest settings to ensure we have the most up-to-date version
                    settings = await api.loadSettings(); 
                    
                    // Re-process all data with the new calculation rules
                    processDataForSelectedDate(); 
                    filterAndRenderTable();
                    
                    btn.disabled = false;
                    btn.innerHTML = 'Save & Recalculate';
                    ui.hideLoadingOverlay(); // Hide overlay after everything is done
                } else {
                     ui.hideLoadingOverlay(); // Hide if settings fail to update for any reason
                }
            }, 100);

        } else {
            pinError.classList.remove('hidden');
            pinInput.value = '';
            pinInput.focus();
        }
    });
    
    pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('pin-submit-btn').click(); });
    
    settingsContent.addEventListener('click', e => {
        if (e.target.closest('.add-tier-btn') || e.target.closest('.remove-tier-btn')) {

            // 1. Find which accordion is currently open
            const allAccordions = Array.from(settingsContent.querySelectorAll('.accordion-item'));
            const openAccordion = e.target.closest('.accordion-item');
            let openAccordionIndex = allAccordions.findIndex(item => item === openAccordion);
            if (openAccordionIndex === -1) openAccordionIndex = 0; // Fallback

            // 2. Get settings and update the tier list
            const tempSettings = calc.updateSettingsFromUI();
            const section = e.target.closest('[data-tier-key]');
            const key = section.dataset.tierKey;
            
            if (e.target.closest('.add-tier-btn')) {
                const newTier = key === 'speedingRangeTiers' ? {from: 0, to: 0, penalty: 0} : { threshold: 0, bonus: 0 };
                tempSettings[key] = [...(tempSettings[key] || []), newTier];
            } else {
                const index = parseInt(e.target.closest('.tier-row').dataset.tierIndex, 10);
                tempSettings[key].splice(index, 1);
            }

            // 3. Re-render the whole panel, passing the open index
            ui.renderSettingsContent(tempSettings, openAccordionIndex);
        }
    });

    document.getElementById('close-edit-btn').addEventListener('click', ui.closeEditPanel);
    document.getElementById('edit-overlay').addEventListener('click', ui.closeEditPanel);
    

    document.getElementById('edit-panel').addEventListener('click', async (e) => {
        const driverForDate = driversForDate.find(d => d.id == currentEditingDriverId);
        const isNew = currentEditingDriverId === null;

        // --- Handle New Manual Report Download ---
        if (e.target.id === 'download-manual-report-btn') {
            downloadManualReport();
            return; // Exit after downloading
        }
        
        // --- New Split Button Logic ---
        const dropdown = document.getElementById('split-button-dropdown');
        const isChevronClick = e.target.closest('#split-button-chevron');
        const isDropdownClick = e.target.closest('#split-button-dropdown');
        if (isChevronClick) {
            dropdown.classList.toggle('hidden');
        } else if (!isDropdownClick) {
            dropdown.classList.add('hidden');
        }
        
        // --- Action Handlers ---
        const saveChanges = async () => {
            if (isNew) return; // Cannot save a new driver this way yet.
            
            // Find the original driver object to get its data
            const driverForDate = processedDriversForDate.find(d => d.id == currentEditingDriverId);
            if (!driverForDate) return false;

            // 1. Get the original CALCULATED report data for accurate comparison.
            const originalReportData = calc.getDriverReportData(driverForDate, settings);
    
            const fieldsToUpdate = {};
            document.querySelectorAll('#edit-content .edit-input').forEach(input => {
                const key = input.id.replace('edit-', '');
                // Handle checkbox vs text/number inputs
                const newValue = input.type === 'checkbox' ? input.checked : input.value;
                let originalValue;

                // 2. Find the correct original value to compare against.
                if (key === 'mpg') {
                    // Compare against the same formatted string.
                    originalValue = parseFloat(driverForDate.mpg).toFixed(2);
                } else if (key === 'availableOffDays') {
                    // Compare against the original calculated value.
                    originalValue = originalReportData.availableOffDays;
                } else if (key === 'escrowDeduct') {
                    // Compare against the original calculated value.
                    originalValue = originalReportData.escrowDeduct;
                } else if (key === 'weeksOut' && settings.weeksOutMethod === 'dailyAccrual') {
                    // Compare against the same formatted string for daily accrual.
                    const numericValue = parseFloat(driverForDate.weeksOut);
                    originalValue = isNaN(numericValue) ? '0.0' : numericValue.toFixed(1);
                }
                else {
                    // For all other fields, use the original driver data.
                    originalValue = driverForDate[key];
                }

                // 3. Only add the field if the value has actually changed.
                // Using parseFloat for numeric comparison where appropriate.
                const numOriginal = parseFloat(originalValue);
                const numNew = parseFloat(newValue);

                if (isNaN(numOriginal) || isNaN(numNew)) {
                    // Fallback to string comparison for non-numeric values.
                    if (String(originalValue) !== String(newValue)) {
                         fieldsToUpdate[key] = newValue;
                    }
                } else {
                    // Use numeric comparison to avoid formatting issues (e.g., 7.1 vs 7.10).
                    if (numOriginal !== numNew) {
                        fieldsToUpdate[key] = newValue;
                    }
                }
            });
            
    
            if (Object.keys(fieldsToUpdate).length > 0) {
                ui.showLoadingOverlay();
                const payDate = driverForDate.pay_date.split('T')[0];
                const updates = Object.entries(fieldsToUpdate).map(([fieldName, newValue]) => {
                    return { fieldName, newValue };
                });
                await api.saveEditableData(driverForDate.id, payDate, updates);

                // Update the local cache of overrides
                // Update the local cache of overrides
                updates.forEach(update => {
                    const { fieldName, newValue } = update;
                    const existingOverrideIndex = savedOverrides.findIndex(ov => String(ov.driverId) === String(driverForDate.id) && ov.payDate?.split('T')[0] === payDate && ov.fieldName === fieldName);
                    if (existingOverrideIndex > -1) {
                        savedOverrides[existingOverrideIndex].newValue = newValue;
                    } else {
                        savedOverrides.push({ driverId: driverForDate.id, payDate: payDate, fieldName: fieldName, newValue: newValue });
                    }
                });

                // --- START: HIGH-PERFORMANCE UPDATE ---
                // 1. Find the single driver we just edited in our processed data list
                const driverToUpdate = processedDriversForDate.find(d => d.id == driverForDate.id);

                if (driverToUpdate) {
                    // 2. Apply the manually edited values to this driver object
                    updates.forEach(update => {
                        const numericValue = parseFloat(update.newValue);
                        driverToUpdate[update.fieldName] = isNaN(numericValue) ? update.newValue : numericValue;
                    });

                    // 3. Re-calculate *only this driver's* report data
                    // We pass 'processedDriversForDate' so percentiles are still accurate
                    const newReportData = calc.getDriverReportData(driverToUpdate, settings, processedDriversForDate);

                    // 4. Apply the new calculated values (like totalTpog, bonuses)
                    Object.assign(driverToUpdate, newReportData);
                    
                    // 5. Re-apply the manual overrides on top of the new report data
                    // (because getDriverReportData may have reset them)
                    updates.forEach(update => {
                        const numericValue = parseFloat(update.newValue);
                        driverToUpdate[update.fieldName] = isNaN(numericValue) ? update.newValue : numericValue;
                    });

                    // 6. Now, just re-render the table. This will be instant.
                    filterAndRenderTable();

                } else {
                    // Fallback to the old (slow) method if the driver wasn't found
                    processDataForSelectedDate();
                    filterAndRenderTable();
                }
                // --- END: HIGH-PERFORMANCE UPDATE ---

                ui.hideLoadingOverlay();
                ui.showToast('Changes saved and table updated!');
                return true;
            } else {
                ui.showToast('No changes were made.');
                return false;
            }
        };

        if (e.target.id === 'save-to-table-btn') {
            await saveChanges();
            ui.closeEditPanel();
        }

        if (e.target.closest('#dropdown-save-and-download')) {
            e.preventDefault();
            const saved = await saveChanges();
            if (saved) {
                downloadManualReport(); // This function is already defined elsewhere
            }
            ui.closeEditPanel();
        }

        if (e.target.closest('#dropdown-download')) {
             e.preventDefault();
             downloadManualReport();
             ui.closeEditPanel();
        }
    
        // --- THIS BLOCK IS THE FIX ---
        if (e.target.closest('#return-to-default-btn')) {
            if (isNew) {
                ui.closeEditPanel();
                return;
            }
            const confirmed = await showCustomConfirm(
                'Revert Changes',
                'This will delete all saved overrides for this driver for this week. This action cannot be undone. Continue?',
                { confirmText: 'Revert', isDanger: true }
            );
            if (confirmed) {
                ui.showLoadingOverlay();
                const payDate = driverForDate.pay_date.split('T')[0];
                
                try {
                    // 1. Wait for the API to confirm deletion
                    await api.revertToDefault(driverForDate.id, payDate);

                    // 2. Update the local cache of overrides
                    savedOverrides = savedOverrides.filter(ov => {
                        const overridePayDate = ov.payDate ? ov.payDate.split('T')[0] : null;
                        // Keep overrides that DON'T match this driverId and payDate
                        return !(String(ov.driverId) === String(driverForDate.id) && overridePayDate === payDate);
                    });

                    // [snippet from 1. TPOG/js/main.js]
                    // 3. (THE FIX)
                    // We must re-run the calculation for ALL drivers
                    // on this date to correctly rebuild the percentile context.
                    processDataForSelectedDate();
                    filterAndRenderTable();

                    // 10. Hide overlay and close panel
                    ui.hideLoadingOverlay();
                    ui.closeEditPanel();
                    ui.showToast('Changes reverted successfully!');
                
                } catch (error) {
                    // Handle API failures
                    console.error("Failed to revert changes:", error);
                    ui.hideLoadingOverlay();
                    showCustomAlert(`Failed to revert changes: ${error.message}. Please try again.`, 'Error');
                }
            }
        }
        // --- END OF THE FIX BLOCK ---
    });

    // Add a global click listener to close the dropdown if clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('split-button-dropdown');
        const container = e.target.closest('.split-button-container');
        if (dropdown && !dropdown.classList.contains('hidden') && !container) {
            dropdown.classList.add('hidden');
        }
    });

    // --- Helper Function: Lock a single driver's week (Promisified for batch use) ---
    const lockDriverWeek = async (driver) => {
        const payDate = driver.pay_date.split('T')[0];
        const finalReportData = calc.getDriverReportData(driver, settings, driversForDate);
        const driverWithCalculations = {
            ...driver,
            ...finalReportData,
            lockedSettings: settings 
        };
        const driverSnapshotJSON = JSON.stringify(driverWithCalculations);
        
        const result = await api.updateLockedData(driver.id, driver.name, payDate, 'lock', driverSnapshotJSON);
        
        allLockedData[`${driver.id}_${payDate}`] = driverSnapshotJSON;

        const driverToUpdate = processedDriversForDate.find(d => d.id == driver.id);
        if (driverToUpdate) {
            const lockedData = JSON.parse(driverSnapshotJSON);
            const originalNote = driverToUpdate.weeklyNote;
            const originalReviewed = driverToUpdate.isDispatcherReviewed;
            Object.assign(driverToUpdate, lockedData); 
            driverToUpdate.isLocked = true;
            driverToUpdate.weeklyNote = originalNote;
            driverToUpdate.isDispatcherReviewed = originalReviewed;
        }
        return result;
    };

    // --- NEW: Handle Checkbox Change (Row & Select All Logic) ---
    tableBody.addEventListener('change', e => {
        if (e.target.classList.contains('driver-select-checkbox')) {
            const anyChecked = document.querySelector('.driver-select-checkbox:checked');
            const bulkBtn = document.getElementById('bulk-lock-btn');
            if (bulkBtn) bulkBtn.classList.toggle('hidden', !anyChecked);
            
            const allCheckboxes = document.querySelectorAll('.driver-select-checkbox');
            const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
            const masterCheckbox = document.getElementById('select-all-drivers');
            if (masterCheckbox) masterCheckbox.checked = allChecked;
        }
    });

    tableBody.addEventListener('click', async e => {
        if (e.target.classList.contains('driver-select-checkbox')) {
            e.stopPropagation();
            return;
        }

        const targetElement = e.target.closest('[data-driver-id]');
        if (e.target.closest('.download-btn')) {
            e.stopPropagation();
            const driver = driversForDate.find(d => d.id == targetElement.dataset.driverId);
            if(driver) ui.downloadDriverReport(driver, settings, driversForDate);
            return;
        }
        if (e.target.closest('.edit-btn')) {
            e.stopPropagation();
            currentEditingDriverId = parseInt(targetElement.dataset.driverId);
            ui.openEditPanel(currentEditingDriverId, { drivers: driversForDate, allDrivers, settings, driversForDate, overriddenDistances });
            return;
        }
        if (e.target.closest('.copy-btn')) {
            e.stopPropagation();
            const driver = driversForDate.find(d => d.id == targetElement.dataset.driverId);
            if(driver) {
                const reportData = calc.getDriverReportData(driver, settings, driversForDate);
                let explanation = `${driver.name} - FINAL %: ${reportData.totalTpog.toFixed(1)}%\n\n` +
                                  `Base Rate: ${settings.baseRate.toFixed(1)}%\n` +
                                  Object.entries(reportData.bonuses).map(([key, value]) =>
                                      `${key}: ${value.bonus >= 0 ? '+' : ''}${value.bonus.toFixed(1)}%`
                                  ).join('\n');
                navigator.clipboard.writeText(explanation).then(() => ui.showToast());
            }
            return;
        }
        if (e.target.closest('.show-history-btn')) {
            e.stopPropagation();
            const driver = driversForDate.find(d => d.id == targetElement.dataset.driverId);
            if (driver) {
                // Pass allWeeklyNotes as the last argument
                ui.openActivityHistoryModal(driver, mileageData, settings, daysTakenHistory, dispatcherOverrides, allLockedData, allWeeklyNotes);
            }
            return;
        }

        if (e.target.closest('.lock-btn')) {
            e.stopPropagation();
            const driver = processedDriversForDate.find(d => d.id == targetElement.dataset.driverId);
            if(driver) {
                const confirmed = await showCustomConfirm(
                    'Lock Week',
                    `Are you sure you want to lock and snapshot this week for ${driver.name}?\n\nThis will save all current data and prevent future backend changes from affecting this record.`,
                    { confirmText: 'Lock & Snapshot' }
                );
                if (confirmed) {
                    ui.showLoadingOverlay();
                    try {
                        // --- UPDATED: Use shared helper function ---
                        await lockDriverWeek(driver);
                        filterAndRenderTable();
                        ui.hideLoadingOverlay();
                        ui.showToast('Week locked & snapshot saved!', 'success');
                    } catch (error) {
                        console.error("Failed to lock week:", error);
                        ui.hideLoadingOverlay();
                        ui.showCustomAlert(`Failed to lock week: ${error.message}. The save was aborted. Please check your connection and try again.`, 'Save Failed');
                    }
                }
            }
            return;
        }

        if (e.target.closest('.unlock-btn')) {
            e.stopPropagation();
            const driver = processedDriversForDate.find(d => d.id == targetElement.dataset.driverId);
            if(driver) {
                const confirmed = await showCustomConfirm(
                    'Unlock Week',
                    `Are you sure you want to UNLOCK this week for ${driver.name}?\n\nThis will delete the snapshot and reload live data.`,
                    { confirmText: 'Unlock', isDanger: true }
                );
                if (confirmed) {
                    ui.showLoadingOverlay();
                    const payDate = driver.pay_date.split('T')[0];
                    
                    api.updateLockedData(driver.id, null, payDate, 'unlock').then(() => {
                        delete allLockedData[`${driver.id}_${payDate}`];
                        processDataForSelectedDate();
                        filterAndRenderTable();
                        ui.hideLoadingOverlay();
                        ui.showToast('Week unlocked! Live data is now active.', 'success');
                    }).catch((error) => {
                        console.error("Failed to unlock week:", error);
                        ui.hideLoadingOverlay();
                        showCustomAlert(`Failed to unlock week: ${error.message}.`, 'Error');
                    });
                }
            }
            return;
        }
        
        // --- DISTANCE TOGGLE ---
        if (e.target.closest('td[data-key="milesWeek"]') || e.target.closest('td[data-key="samsaraDistance"]')) {
            if (!currentUser || currentUser.role.trim() !== 'Admin') return;
            const driver = processedDriversForDate.find(d => d.id == e.target.closest('tr').dataset.driverId);
            if (!driver || driver.isLocked) return;
            
            ui.showLoadingOverlay();
            setTimeout(() => {
                const payDate = driver.pay_date.split('T')[0];
                const overrideKey = `${driver.id}_${payDate}`;
                const distanceType = e.target.closest('td').dataset.key;

                if (distanceType === 'samsaraDistance') {
                    if (overriddenDistances[overrideKey] === 'samsaraDistance') delete overriddenDistances[overrideKey];
                    else overriddenDistances[overrideKey] = 'samsaraDistance';
                } else {
                    if (overriddenDistances[overrideKey]) delete overriddenDistances[overrideKey];
                }

                api.saveDistanceOverride(driver.id, overriddenDistances[overrideKey] || null, payDate);
                processDataForSelectedDate();
                filterAndRenderTable();
                ui.hideLoadingOverlay();
            }, 50); 
            return;
        }

        // --- MPG TOGGLE (NEW) ---
        if (e.target.closest('td[data-key="mpg"]') || e.target.closest('td[data-key="stubMpg"]')) {
            if (!currentUser || currentUser.role.trim() !== 'Admin') return;
            const driver = processedDriversForDate.find(d => d.id == e.target.closest('tr').dataset.driverId);
            if (!driver || driver.isLocked) return;

            ui.showLoadingOverlay();
            setTimeout(async () => {
                const payDate = driver.pay_date.split('T')[0];
                const clickedType = e.target.closest('td').dataset.key; // 'mpg' or 'stubMpg'
                
                // Toggle Logic: If clicking the one that is NOT active, set it as active.
                // If clicking the one that IS active, do nothing (or reset to default if logic requires).
                // Here we simply force the clicked source to be the active one.
                
                // We update the local state immediately for the UI
                const overrideKey = `${driver.id}_${payDate}`;
                mpgOverrides[overrideKey] = clickedType;

                await api.saveMpgOverride(driver.id, clickedType, payDate);
                
                processDataForSelectedDate();
                filterAndRenderTable();
                ui.hideLoadingOverlay();
            }, 50);
            return;
        }
        const row = e.target.closest('tr[data-driver-id]');
        if (row) {
            const driver = driversForDate.find(d => d.id == row.dataset.driverId);
            if (driver) {
                ui.openHistoryModal(driver, () => api.fetchSafetyHistory(driver.name), () => api.fetchFuelHistory(driver.name), () => api.fetchPOHistory(driver.name), () => api.fetchFuelPurchaseHistory(driver.name), () => api.fetchChangelogHistory(driver.name), mileageData);
            }
        }
    });
    
    tooltipHandler(event, tableBody);
    tooltipHandler(event, activityHistoryContent);
    tooltipHandler(event, settingsContent);
    
    tableHead.addEventListener('click', async e => {
        // --- NEW: Handle Select All ---
        if (e.target.id === 'select-all-drivers') {
            const isChecked = e.target.checked;
            document.querySelectorAll('.driver-select-checkbox').forEach(cb => cb.checked = isChecked);
            const bulkBtn = document.getElementById('bulk-lock-btn');
            if (bulkBtn) bulkBtn.classList.toggle('hidden', !isChecked);
        }

        // --- NEW: Handle Bulk Lock Button ---
        if (e.target.id === 'bulk-lock-btn') {
            e.stopPropagation();
            const checkboxes = document.querySelectorAll('.driver-select-checkbox:checked');
            const selectedIds = Array.from(checkboxes).map(cb => cb.value);

            if (selectedIds.length === 0) return;

            const driversToLock = processedDriversForDate.filter(d => 
                selectedIds.includes(String(d.id)) && !d.isLocked && d.contract_type === 'TPOG'
            );

            if (driversToLock.length === 0) {
                ui.showToast('Selected drivers are already locked or invalid.');
                return;
            }

            const confirmed = await showCustomConfirm(
                'Bulk Lock',
                `Lock ${driversToLock.length} drivers? This may take a moment.`,
                { confirmText: 'Lock All' }
            );

            if (confirmed) {
                ui.showLoadingOverlay();
                try {
                    // Supabase is fast, so we can process all locks in parallel without fear of 429s
                    await Promise.all(driversToLock.map(d => lockDriverWeek(d)));
                    
                    filterAndRenderTable();
                    ui.hideLoadingOverlay();
                    ui.showToast(`Successfully locked ${driversToLock.length} drivers!`, 'success');
                } catch (error) {
                    console.error("Bulk lock failed:", error);
                    ui.hideLoadingOverlay();
                    // Even if one fails, we re-render to show the ones that succeeded
                    filterAndRenderTable(); 
                    ui.showCustomAlert(`Bulk lock encountered an error: ${error.message}`, 'Warning');
                }
            }
        }
        // ------------------------------

        const menuButton = e.target.closest('.menu-button');
        if (menuButton) {
            e.stopPropagation();
            const menu = menuButton.nextElementSibling;
            if (menu) {
                const isOpening = menu.classList.contains('hidden');
                document.querySelectorAll('.column-menu').forEach(m => m.classList.add('hidden'));
                if (isOpening) menu.classList.remove('hidden');
            }
        }
        const actionLink = e.target.closest('[data-action]');
        if (actionLink) {
            e.preventDefault();
            const action = actionLink.dataset.action;
            const key = actionLink.closest('th').dataset.key;
            if (action.startsWith('pin') || action === 'unpin') {
                pinnedColumns.left = pinnedColumns.left.filter(k => k !== key);
                pinnedColumns.right = pinnedColumns.right.filter(k => k !== key);
                if (action === 'pin-left') pinnedColumns.left.push(key);
                if (action === 'pin-right') pinnedColumns.right.splice(pinnedColumns.right.indexOf('actions'), 0, key);
                filterAndRenderTable();
            }
            
            if (action.startsWith('sort')) {
                const isAsc = action === 'sort-asc';
                processedDriversForDate.sort((a, b) => {
                    let valA = a[key];
                    let valB = b[key];
                    if (typeof valA === 'number') return isAsc ? valA - valB : valB - valA;
                    return isAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
                });
                filterAndRenderTable();
            }

            actionLink.closest('.column-menu').classList.add('hidden');
        }
    });
    
    tableHead.addEventListener('dragstart', e => { if (e.target.closest('th')) { draggedColumnKey = e.target.closest('th').dataset.key; e.dataTransfer.effectAllowed = 'move'; } });
    tableHead.addEventListener('dragover', e => { e.preventDefault(); if (e.target.closest('th') && e.target.closest('th').dataset.key !== draggedColumnKey) e.target.closest('th').classList.add('drag-over'); });
    tableHead.addEventListener('dragleave', e => e.target.closest('th')?.classList.remove('drag-over'));
    tableHead.addEventListener('drop', e => {
        e.preventDefault();
        const th = e.target.closest('th');
        if (th) {
            const fromIndex = orderedColumnKeys.indexOf(draggedColumnKey);
            const toIndex = orderedColumnKeys.indexOf(th.dataset.key);
            if (fromIndex !== toIndex) {
                const [movedItem] = orderedColumnKeys.splice(fromIndex, 1);
                orderedColumnKeys.splice(toIndex, 0, movedItem);
                filterAndRenderTable();
            }
            th.classList.remove('drag-over');
        }
    });
    tableHead.addEventListener('dragend', () => { draggedColumnKey = null; });

    document.addEventListener('click', e => { if (!e.target.closest('#general-filter-container, .menu-button, #column-toggle-filter')) { generalFilterPanel.classList.add('hidden'); columnToggleOptions.classList.add('hidden'); document.querySelectorAll('.column-menu').forEach(m => m.classList.add('hidden')); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { ui.closeSettings(); ui.closeEditPanel(); ui.closeHistoryModal(); } });

    const historyModal = document.getElementById('history-modal');
    document.getElementById('close-history-btn').addEventListener('click', ui.closeHistoryModal);
    historyModal.addEventListener('click', (e) => {
        if (e.target === historyModal) ui.closeHistoryModal();
        const header = e.target.closest('.changelog-group-header');
        if (header) {
            header.nextElementSibling.classList.toggle('hidden');
            header.querySelector('.changelog-chevron').classList.toggle('rotate-90');
        }
    });

    const activityHistoryModal = document.getElementById('activity-history-modal');
    document.getElementById('close-activity-history-btn').addEventListener('click', ui.closeActivityHistoryModal);
    activityHistoryModal.addEventListener('click', (e) => { if (e.target === activityHistoryModal) ui.closeActivityHistoryModal(); });
    
    document.querySelector('.history-tab[data-tab="safety"]').parentElement.addEventListener('click', (e) => { if (e.target.closest('.history-tab')) ui.switchHistoryTab(e.target.closest('.history-tab').dataset.tab); });
    
    window.addEventListener('resize', () => ui.updateColumnPinning(pinnedColumns));

    sidebarToggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        // No longer need to toggle a class on mainAppContainer
    
        // Update the button text and icon
        const isCollapsed = sidebar.classList.contains('collapsed');
        const toggleBtnText = sidebarToggleBtn.querySelector('.sidebar-text');
        
        if (toggleBtnText) {
            toggleBtnText.textContent = isCollapsed ? 'Expand' : 'Collapse';
        }
    });

    sidebarLogoutBtn.addEventListener('click', logout);
    

    document.getElementById('nav-table').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('table');
    });

    document.getElementById('nav-profiles').addEventListener('click', (e) => {
        e.preventDefault();
        // The 'else' block that showed an alert has been removed.
        if (currentUser && currentUser.role.trim() === 'Admin') {
            switchView('profiles');
        }
    });

    // --- ADD THIS NEW BLOCK ---
    document.getElementById('nav-archive').addEventListener('click', (e) => {
        e.preventDefault();
        if (currentUser && (currentUser.role.trim() === 'Admin' || currentUser.role.trim() === 'Onboarder')) {
            switchView('archive');
        }
    });
    // --- END OF NEW BLOCK ---

    document.getElementById('add-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button[type="submit"]');
        button.disabled = true;
    
        const isEdit = !!currentEditingUserEmail;
        
        // Create the base user data object
        const userData = {
            email: document.getElementById('new-user-email').value,
            password: document.getElementById('new-user-password').value,
            role: document.getElementById('new-user-role').value,
            access: document.getElementById('new-user-access').value
        };
    
        let result;
        if (isEdit) {
            button.textContent = 'Updating...';
            // For editing, the backend expects 'originalEmail' and 'newEmail'
            const editData = {
                ...userData,
                originalEmail: currentEditingUserEmail,
                newEmail: userData.email
            };
            delete editData.email; // Remove the plain 'email' property
            result = await api.editUser(editData);
        } else {
            button.textContent = 'Adding...';
            // For adding, the backend expects just 'email'
            result = await api.addUser(userData);
        }
    
        if (result.status === 'success') {
            showCustomAlert(`User ${isEdit ? 'updated' : 'added'} successfully!`, 'Success');
            document.getElementById('add-user-form').reset();
            document.getElementById('add-user-modal').classList.add('hidden');
            loadAndRenderUsers();
        } else {
            showCustomAlert(`Error: ${result.message}`, 'Error');
        }
    
        button.disabled = false;
        const submitButtonText = document.querySelector('#add-user-form button[type="submit"]');
        if (submitButtonText) {
            submitButtonText.textContent = isEdit ? 'Update User' : 'Add User';
        }
    });

    // Replace the old form logic with this new block
const newUserRoleSelect = document.getElementById('new-user-role');
const newUserAccessContainer = document.getElementById('new-user-access-container');
const newUserAccessLabel = document.getElementById('new-user-access-label');
const newUserAccessInput = document.getElementById('new-user-access-input');
const addAccessBtn = document.getElementById('add-access-btn');
const accessCustomDropdown = document.getElementById('access-custom-dropdown');
const accessTagsContainer = document.getElementById('access-tags-container');
const hiddenAccessInput = document.getElementById('new-user-access');

if (newUserRoleSelect && newUserAccessInput && addAccessBtn && accessTagsContainer) {
    let currentAccessList = [];

    const updateHiddenInput = () => {
        hiddenAccessInput.value = currentAccessList.join(',');
    };

    const renderTags = () => {
        accessTagsContainer.innerHTML = '';
        currentAccessList.forEach(name => {
            const tag = document.createElement('div');
            tag.className = 'flex items-center gap-2 bg-slate-700 text-slate-200 text-sm font-medium px-3 py-1 rounded-full';
            tag.innerHTML = `
                <span>${name}</span>
                <button type="button" class="text-slate-400 hover:text-white" data-name="${name}">&times;</button>
            `;
            accessTagsContainer.appendChild(tag);
        });
        updateHiddenInput();
    };

    const addAccessName = () => {
        const name = newUserAccessInput.value.trim();
        if (name && !currentAccessList.includes(name)) {
            currentAccessList.push(name);
            renderTags();
        }
        newUserAccessInput.value = '';
        newUserAccessInput.focus();
    };

    const populateCustomDropdown = (items) => {
        accessCustomDropdown.innerHTML = '';
        if (items.length === 0) {
            accessCustomDropdown.innerHTML = '<div class="dropdown-item text-sm text-slate-400">No matches found</div>';
        } else {
            items.forEach(name => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'dropdown-item';
                itemDiv.textContent = name;
                itemDiv.dataset.name = name;
                accessCustomDropdown.appendChild(itemDiv);
            });
        }
    };
    
    accessTagsContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const nameToRemove = e.target.dataset.name;
            currentAccessList = currentAccessList.filter(name => name !== nameToRemove);
            renderTags();
        }
    });

    addAccessBtn.addEventListener('click', addAccessName);

    newUserAccessInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addAccessName();
        }
    });
    
    newUserRoleSelect.addEventListener('change', () => {
        const selectedRole = newUserRoleSelect.value;
        
        if (selectedRole === 'Admin' || selectedRole === 'Onboarder') {
            newUserAccessContainer.classList.add('hidden');
            currentAccessList = [];
            renderTags();
            return;
        }

        newUserAccessContainer.classList.remove('hidden');

        let accessKey = null;
        let labelText = 'Access';
        let placeholderText = 'Enter a value';
        let allItems = [];

        switch (selectedRole) {
            case 'Dispatcher':
                labelText = 'Dispatcher Name(s)';
                placeholderText = 'Select or type a dispatcher name';
                accessKey = 'dispatcher';
                break;
            case 'Team':
                labelText = 'Team Name(s)';
                placeholderText = 'Select or type a team name';
                accessKey = 'team';
                break;
            case 'Franchise':
                labelText = 'Franchise Name(s)';
                placeholderText = 'Select or type a franchise name';
                accessKey = 'franchise';
                break;
            case 'Driver Rep':
                labelText = 'Driver Rep Name(s)';
                placeholderText = 'Select or type a driver rep name';
                accessKey = 'driver_rep';
                break;
            case 'Marketing':
                labelText = 'Driver Name(s)';
                placeholderText = 'Select or type a driver name';
                accessKey = 'name';
                break;
        }

        newUserAccessLabel.textContent = labelText;
        newUserAccessInput.placeholder = placeholderText;

        if (accessKey && allDrivers) {
            allItems = [...new Set(allDrivers.map(d => d[accessKey]).filter(Boolean))].sort();
        }
        
        newUserAccessInput.dataset.allItems = JSON.stringify(allItems);
        populateCustomDropdown(allItems);
    });
    
    newUserAccessInput.addEventListener('focus', () => {
        const allItems = JSON.parse(newUserAccessInput.dataset.allItems || '[]');
        const query = newUserAccessInput.value.toLowerCase();
        const filteredItems = allItems.filter(item => item.toLowerCase().includes(query));
        populateCustomDropdown(filteredItems);
        accessCustomDropdown.classList.remove('hidden');
    });

    newUserAccessInput.addEventListener('blur', () => {
        setTimeout(() => {
            accessCustomDropdown.classList.add('hidden');
        }, 150);
    });

    newUserAccessInput.addEventListener('input', () => {
        const query = newUserAccessInput.value.toLowerCase();
        const allItems = JSON.parse(newUserAccessInput.dataset.allItems || '[]');
        const filteredItems = allItems.filter(item => item.toLowerCase().includes(query));
        populateCustomDropdown(filteredItems);
        if (!accessCustomDropdown.classList.contains('hidden')) {
             accessCustomDropdown.classList.remove('hidden');
        }
    });

    accessCustomDropdown.addEventListener('click', (e) => {
        if (e.target.classList.contains('dropdown-item') && e.target.dataset.name) {
            newUserAccessInput.value = e.target.dataset.name;
            addAccessName();
            accessCustomDropdown.classList.add('hidden');
        }
    });

    document.getElementById('add-user-form').addEventListener('reset', () => {
        currentAccessList = [];
        renderTags();
        newUserRoleSelect.dispatchEvent(new Event('change'));
    });
}

    // --- NEW: Marketing Help Modal Listeners (Moved to correct function) ---
    const marketingHelpModal = document.getElementById('marketing-help-modal');
    if (marketingHelpModal) {
        const dynamicContentEl = document.getElementById('marketing-help-dynamic-content');

        document.getElementById('marketing-help-btn').addEventListener('click', () => {
            // 1. Generate content from the global 'settings' object
            const helpContentHtml = generateMarketingHelpContent(settings);
            // 2. Inject the dynamic content into the modal
            dynamicContentEl.innerHTML = helpContentHtml;
            // 3. Show the modal
            marketingHelpModal.classList.remove('hidden');
        });
        
        const closeHelpModal = () => marketingHelpModal.classList.add('hidden');

        document.getElementById('marketing-help-modal-close-btn').addEventListener('click', closeHelpModal);
        document.getElementById('marketing-help-modal-ok-btn').addEventListener('click', closeHelpModal);
        
        marketingHelpModal.addEventListener('click', (e) => {
            if (e.target.id === 'marketing-help-modal') {
                closeHelpModal();
            }
        });
    }
    // --- END NEW ---
}

async function logout() {
    const confirmed = await showCustomConfirm('Logout', 'Are you sure you want to log out?', { confirmText: 'Logout' });
    if (confirmed) {
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('user');
        localStorage.removeItem('loginTimestamp');
        window.location.reload();
    }
}

function switchView(viewName) {
    // Hide all main view containers first
    document.querySelector('main > header').classList.add('hidden');
    document.getElementById('table-wrapper').closest('.bg-slate-900').classList.add('hidden');
    document.getElementById('profiles-view').classList.add('hidden');
    document.getElementById('dispatcher-view').classList.add('hidden');
    document.getElementById('archive-view').classList.add('hidden'); // <-- ADD THIS LINE
    document.getElementById('fuel-tank-view').classList.add('hidden'); // <-- ADD THIS LINE

    // Deactivate all sidebar links
    document.querySelectorAll('#sidebar nav a').forEach(a => a.classList.remove('active', 'bg-slate-700'));

    if (viewName === 'table') {
        document.querySelector('main > header').classList.remove('hidden');
        document.getElementById('table-wrapper').closest('.bg-slate-900').classList.remove('hidden');
        document.getElementById('nav-table').classList.add('active', 'bg-slate-700');
        

        // Re-calculate column pinning offsets *after* the table is visible.
        // This fixes the bug where pinning breaks after saving from another view.
        requestAnimationFrame(() => {
            ui.updateColumnPinning(pinnedColumns);
        });


    } else if (viewName === 'profiles') {
        document.getElementById('profiles-view').classList.remove('hidden');
        document.getElementById('nav-profiles').classList.add('active', 'bg-slate-700');
        loadAndRenderUsers();
    } else if (viewName === 'dispatcher') {
        document.getElementById('dispatcher-view').classList.remove('hidden');
        document.getElementById('nav-dispatcher').classList.add('active', 'bg-slate-700');
        // Check if it's the first time loading this view to avoid re-initializing
        if (!document.body.classList.contains('dispatcher-initialized')) {
            
            // --- THIS IS THE KEY CHANGE ---
            // Pass all the globally loaded data into the verification view.
            initDispatcherView(
                currentUser, 
                allWeeklyNotes, 
                allLockedData, 
                allDrivers, 
                mileageData, 
                allSafetyData, 
                daysTakenHistory,
                dispatcherOverrides // This is the map, not the raw data
            ); 
            // --- END OF CHANGE ---

            document.body.classList.add('dispatcher-initialized');
        }
    } else if (viewName === 'archive') { // <-- ADD THIS ENTIRE ELSE IF BLOCK
        document.getElementById('archive-view').classList.remove('hidden');
        document.getElementById('nav-archive').classList.add('active', 'bg-slate-700');
        if (!document.body.classList.contains('archive-initialized')) {
            initArchiveView(allDrivers); // Pass allDrivers for the feedback modal
            document.body.classList.add('archive-initialized');
        }

        if (currentUser && (currentUser.role.trim() === 'Admin' || currentUser.role.trim() === 'Onboarder')) {
            // Ensure all action buttons are visible
            document.getElementById('archive-request-feedback-btn').style.display = '';
            // We must show the *parent* containers for the status buttons
            document.getElementById('archive-status-buttons').style.display = '';
            document.getElementById('archive-status-edit').style.display = '';
        } else {
            // Hide all action buttons for other roles
            document.getElementById('archive-request-feedback-btn').style.display = 'none';
            document.getElementById('archive-status-buttons').style.display = 'none';
            document.getElementById('archive-status-edit').style.display = 'none';
        }
    } else if (viewName === 'fuel-tank') {
        document.getElementById('fuel-tank-view').classList.remove('hidden');
        document.getElementById('nav-fuel-tank').classList.add('active', 'bg-slate-700');
    }
}

async function loadAndRenderUsers() {
    const userTableBody = document.getElementById('user-profiles-table-body');
    userTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-slate-500">Loading users...</td></tr>`;
    const result = await api.fetchAllUsers();
    if (result.status === 'success') {
        userTableBody.innerHTML = result.users.map(user => `
            <tr class="hover:bg-slate-800">
                <td class="px-4 py-2">${user.email}</td>
                <td class="px-4 py-2">${user.role}</td>
                <td class="px-4 py-2">${user.access || '-'}</td>
                <td class="px-4 py-2 text-center">
                    <button class="p-1 text-slate-400 hover:text-white" title="Edit"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z"></path></svg></button>
                    <button class="p-1 text-slate-400 hover:text-red-500" title="Delete"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </td>
            </tr>
        `).join('');
    } else {
        userTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-red-500">Failed to load users.</td></tr>`;
    }
}

async function initializeApp() {
    ui.updateLoadingProgress('10%'); // Initial progress

    // Start all data fetches in parallel and log their performance
    const [
        settingsData,
        mileage,
        drivers,
        safetyData,
        financeData,
        daysHistory,
        distanceOverrides,
        dispatchOverrides,
        savedOverridesData,
        weeklyNotesData,
        weeklyLocksData,
        mpgOverridesData // <--- Add new variable here
    ] = await Promise.all([
        logPerformance('Settings', api.loadSettings()),
        logPerformance('Mileage Data', api.loadMileageData()),
        logPerformance('Driver Data', api.fetchDriverData()),
        logPerformance('All Safety Data', api.loadAllSafetyData()),
        logPerformance('Financial Data', api.loadFinancialData()),
        logPerformance('Days Taken History', api.fetchDaysTakenHistory()),
        logPerformance('Distance Overrides', api.loadDistanceOverrides()),
        logPerformance('Dispatcher Overrides', api.loadDispatcherOverrides()),
        logPerformance('Saved Overrides', api.loadOverrides()),
        logPerformance('Weekly Notes', api.loadWeeklyNotes()),
        logPerformance('Locked Data', api.loadLockedData()),
        logPerformance('MPG Overrides', api.loadMpgOverrides())
    ]);

    // Assign results to state variables once all promises are resolved
    settings = settingsData;
    mileageData = mileage;
    allDrivers = drivers;
    allSafetyData = safetyData;
    financialData = financeData;
    daysTakenHistory = daysHistory;
    overriddenDistances = distanceOverrides;
    dispatcherOverrides = dispatchOverrides;
    savedOverrides = savedOverridesData;
    allWeeklyNotes = weeklyNotesData;
    allLockedData = weeklyLocksData;
    mpgOverrides = mpgOverridesData; // <--- Correctly assign the variable

    // --- CREATE INDEXES (The Speed Fix) ---
    // 1. Mileage Index
    mileageIndex = {};
    if (mileageData) {
        mileageData.forEach(m => {
            const name = m.driver_name || m.name; 
            if (!mileageIndex[name]) mileageIndex[name] = [];
            mileageIndex[name].push(m);
        });
    }

    // 2. Safety Index
    safetyIndex = {};
    if (allSafetyData) {
        allSafetyData.forEach(s => {
            if (!safetyIndex[s.name]) safetyIndex[s.name] = [];
            safetyIndex[s.name].push(s);
        });
    }

    // 3. Days Taken Index
    daysTakenIndex = {};
    if (daysTakenHistory) {
        daysTakenHistory.forEach(h => {
            const name = h.driver_name;
            if (!daysTakenIndex[name]) daysTakenIndex[name] = [];
            daysTakenIndex[name].push(h);
        });
    }
    // ---------------------------------------

    ui.updateLoadingProgress('80%');

    if (allDrivers) {
        allDrivers.forEach(driver => {
            const payDate = driver.pay_date.split('T')[0];
            const financialRecord = financialData.find(fin => fin.driver_name === driver.name && fin.pay_date === payDate);
            if (financialRecord) {
                driver.gross = financialRecord.weekly_gross || driver.gross;
                driver.stubMiles = financialRecord.weekly_miles || 0;
                driver.rpm = financialRecord.weekly_rpm || driver.rpm;
            }
        });
    }

    // Quietly cache detailed history data in the background after the app is interactive
    setTimeout(api.cacheAllHistoryDataInBackground, 1000);
}

function showMainApp() {
    const mainAppContainer = document.getElementById('main-app-container');
    const loadingOverlay = document.getElementById('loading-overlay');

    if (allDrivers) {
        let driversForUser = allDrivers;
        if (currentUser && currentUser.role && currentUser.role.trim() !== 'Admin') {
            const userAccessList = String(currentUser.access || '').split(',').map(item => item.trim());
            const userRole = currentUser.role.trim();
            driversForUser = allDrivers.filter(driver => {
                if (userRole === 'Dispatcher' && userAccessList.includes(driver.dispatcher)) return true;
                if (userRole === 'Team' && userAccessList.includes(driver.team)) return true;
                if (userRole === 'Franchise' && userAccessList.includes(driver.franchise)) return true;
                if (userRole === 'Driver Rep' && userAccessList.includes(driver.driver_rep)) return true;
                if (userRole === 'Marketing' && userAccessList.includes(driver.name)) return true;
                return false;
            });
        }

        const payDates = [...new Set(driversForUser.map(d => d.pay_date && d.pay_date.split('T')[0]))].filter(Boolean).sort().reverse();
        
        if (payDates.length > 0) {
            payDateSelect.innerHTML = payDates.map(date => `<option value="${date}">${date}</option>`).join('');
        } else {
             payDateSelect.innerHTML = `<option>No weeks found</option>`;
        }

        ui.populateColumnToggle(orderedColumnKeys, pinnedColumns, (newVisibleColumns) => {
            visibleColumnKeys = newVisibleColumns;
            filterAndRenderTable();
        }, visibleColumnKeys);

        processDataForSelectedDate(); 
        filterAndRenderTable();

    } else {
        tableBody.innerHTML = `<tr><td colspan="${Object.keys(config.columnConfig).length}" class="text-center py-10 text-red-500">Failed to load data.</td></tr>`;
    }
    
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    if (mainAppContainer) mainAppContainer.style.display = 'block';
    
    const userRole = currentUser ? currentUser.role.trim() : '';
    if (userRole === 'Dispatcher' || userRole === 'Team') {
        switchView('dispatcher');
    } else if (userRole === 'Onboarder') {
        switchView('archive');
    } else {
        switchView('table');
    }

    sidebar.classList.add('collapsed');
}

document.addEventListener('DOMContentLoaded', () => {
    dataLoadingPromise = initializeApp(); 
    initializeEventListeners();

    const loginBtn = document.getElementById('login-btn');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginError = document.getElementById('login-error');

    usernameInput.placeholder = "Email";
    usernameInput.type = "email";

    // --- HELPER: Sets up the UI after a successful login (Fresh or Restored) ---
    async function setupSession(user, token) {
        currentUser = user;
        sessionToken = token;

        // 1. Persist session (2 Hours)
        localStorage.setItem('sessionToken', sessionToken);
        localStorage.setItem('user', JSON.stringify(currentUser));
        // Only set timestamp if it doesn't exist (preserve original login time on refresh)
        if (!localStorage.getItem('loginTimestamp')) {
            localStorage.setItem('loginTimestamp', Date.now());
        }

        // 2. Apply Role-Based UI Logic
        const userRole = currentUser.role.trim();
        const allowedVerificationRoles = ['Admin', 'Dispatcher', 'Team'];

        if (!allowedVerificationRoles.includes(userRole)) {
            const navDispatcherLink = document.getElementById('nav-dispatcher');
            if (navDispatcherLink) navDispatcherLink.style.display = 'none';
        }

        if (userRole !== 'Admin') {
            const navProfilesLink = document.getElementById('nav-profiles');
            if (navProfilesLink) navProfilesLink.style.display = 'none';
            const settingsBtn = document.getElementById('open-settings-btn');
            if (settingsBtn) settingsBtn.style.display = 'none';
            
            const manualReportBtn = document.getElementById('create-manual-report-btn');
            if (manualReportBtn && userRole !== 'Marketing') { 
                manualReportBtn.style.display = 'none';
            }

            const navFuelTankLink = document.getElementById('nav-fuel-tank');
            if (navFuelTankLink) navFuelTankLink.style.display = 'none';
            
            if (userRole !== 'Driver Rep' && userRole !== 'Marketing' && userRole !== 'Franchise') {
                visibleColumnKeys = visibleColumnKeys.filter(key => key !== 'actions');
            }
        }

        if (userRole === 'Onboarder') {
            const navTableLink = document.getElementById('nav-table');
            if (navTableLink) navTableLink.style.display = 'none';
        }

        if (userRole === 'Marketing') {
            const navArchiveLink = document.getElementById('nav-archive');
            if (navArchiveLink) navArchiveLink.style.display = 'none';
            const navDispatcherLink = document.getElementById('nav-dispatcher');
            if (navDispatcherLink) navDispatcherLink.style.display = 'none';
            const navFuelTankLink = document.getElementById('nav-fuel-tank');
            if (navFuelTankLink) navFuelTankLink.style.display = 'none';
            const navProfilesLink = document.getElementById('nav-profiles');
            if (navProfilesLink) navProfilesLink.style.display = 'none';
            const helpBtn = document.getElementById('marketing-help-btn');
            if (helpBtn) helpBtn.classList.remove('hidden');
        }

        if (userRole === 'Dispatcher' || userRole === 'Driver Rep' || userRole === 'Franchise') {
            const navArchiveLink = document.getElementById('nav-archive');
            if (navArchiveLink) navArchiveLink.style.display = 'none';
            const helpBtn = document.getElementById('marketing-help-btn');
            if (helpBtn) helpBtn.classList.remove('hidden');
        }

        // 3. Switch Screens
        const loginOverlay = document.getElementById('login-overlay');
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loginOverlay) loginOverlay.style.display = 'none';
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');

        await dataLoadingPromise;
        await showMainApp();
    }

    // --- CHECK FOR RESTORABLE SESSION ---
    const storedToken = localStorage.getItem('sessionToken');
    const storedUser = localStorage.getItem('user');
    const storedTime = localStorage.getItem('loginTimestamp');
    const SESSION_DURATION = 2 * 60 * 60 * 1000; // 2 Hours in ms

    if (storedToken && storedUser && storedTime) {
        const age = Date.now() - parseInt(storedTime, 10);
        if (age < SESSION_DURATION) {
            // Session is valid, restore it
            setupSession(JSON.parse(storedUser), storedToken).catch(err => {
                console.error("Session restore failed:", err);
                localStorage.clear(); // Clear bad data
            });
        } else {
            // Session expired
            localStorage.clear();
        }
    }

    async function attemptLogin() {
        // --- Start Loading State ---
        loginBtn.disabled = true;
        loginError.classList.add('hidden');
        loginBtn.innerHTML = `
            <svg class="spinner-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <span>Signing in...</span>
        `;

        const email = usernameInput.value;
        const password = passwordInput.value;
        const result = await api.loginUser(email, password);

        if (result.status === 'success') {
            // Reset timestamp for fresh login
            localStorage.setItem('loginTimestamp', Date.now());
            await setupSession(result.user, result.token);
        } else {
            // --- End Loading State on Failure ---
            loginError.textContent = result.message || 'Invalid email or password.';
            loginError.classList.remove('hidden');
            loginBtn.disabled = false;
            loginBtn.innerHTML = `<span>Sign In</span>`;
        }
    }

    // --- Create dynamic background effects ---
    const headlightsContainer = document.getElementById('headlights-container');
    if (headlightsContainer) {
        for (let i = 0; i < 15; i++) {
            const headlight = document.createElement('div');
            headlight.className = 'headlight';
            headlight.style.top = `${i * 160}px`;
            headlight.style.animationDelay = `${i * 0.15}s`;
            headlightsContainer.appendChild(headlight);
        }
    }

    loginBtn.addEventListener('click', attemptLogin);
    passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            attemptLogin();
        }
    });
});

function openUserModal(isEdit = false, userData = {}) {
    const modal = document.getElementById('add-user-modal');
    const form = document.getElementById('add-user-form');
    const modalTitle = modal.querySelector('h2');
    const passwordInput = document.getElementById('new-user-password');
    const emailInput = document.getElementById('new-user-email');
    const roleSelect = document.getElementById('new-user-role');
    const accessInput = document.getElementById('new-user-access-input');
    const accessTagsContainer = document.getElementById('access-tags-container');
    const hiddenAccessInput = document.getElementById('new-user-access');

    form.reset();
    accessTagsContainer.innerHTML = '';
    
    if (isEdit) {
        modalTitle.textContent = 'Edit User';
        passwordInput.placeholder = "New Password (optional)";
        passwordInput.required = false;
        
        emailInput.value = userData.email || '';
        roleSelect.value = userData.role || 'Dispatcher';

        // Set access tags
        const accessList = (userData.access && userData.access !== '-') ? userData.access.split(',') : [];
        const hiddenInput = document.getElementById('new-user-access');
        const tagsContainer = document.getElementById('access-tags-container');
        hiddenInput.value = accessList.join(',');
        tagsContainer.innerHTML = accessList.map(name => `
            <div class="flex items-center gap-2 bg-slate-700 text-slate-200 text-sm font-medium px-3 py-1 rounded-full">
                <span>${name}</span>
                <button type="button" class="text-slate-400 hover:text-white" data-name="${name}">&times;</button>
            </div>
        `).join('');

        // Trigger change to show correct access input field
        roleSelect.dispatchEvent(new Event('change'));

    } else {
        modalTitle.textContent = 'Add New User';
        passwordInput.placeholder = "Password";
        passwordInput.required = true;
        currentEditingUserEmail = null;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function processDataForSelectedDate() {
    const selectedDate = payDateSelect.value;
    
    // --- THIS IS THE FIX ---
    // Create a "deep copy" of the drivers for this date.
    // This stops the original 'allDrivers' list from being permanently changed
    // when overrides are applied.
    driversForDate = allDrivers
        .filter(d => d.pay_date && d.pay_date.split('T')[0] === selectedDate)
        .map(d => JSON.parse(JSON.stringify(d))); // <-- This deep copy is the fix
    // --- END OF FIX ---

    // The rest of the function remains identical
    // We now pass the INDEXES (mileageIndex, safetyIndex, daysTakenIndex) instead of the raw arrays
    // Added mpgOverrides to the call
    processedDriversForDate = calc.processDriverDataForDate(driversForDate, mileageIndex, settings, safetyIndex, overriddenDistances, daysTakenIndex, dispatcherOverrides, allDrivers, mpgOverrides);

    // --- START: APPLY OVERRIDES ---
    // Apply saved overrides AFTER all calculations are done to prevent them from being overwritten.
    if (processedDriversForDate.length > 0 && savedOverrides.length > 0) {
        const overridesForThisDate = savedOverrides.filter(ov => ov.payDate && ov.payDate.split('T')[0] === selectedDate);

        overridesForThisDate.forEach(override => {
            const driverToUpdate = processedDriversForDate.find(d => {
                const idMatch = String(d.id || '').trim() === String(override.driverId || '').trim();
                const driverPayDate = d.pay_date ? d.pay_date.split('T')[0] : null;
                const overridePayDate = override.payDate ? override.payDate.split('T')[0] : null;
                const dateMatch = driverPayDate && overridePayDate && driverPayDate === overridePayDate;
                return idMatch && dateMatch;
            });

            if (driverToUpdate) {
                const numericValue = parseFloat(override.newValue);
                driverToUpdate[override.fieldName] = isNaN(numericValue) ? override.newValue : numericValue;
            }
        });
    }
    // --- END: APPLY OVERRIDES ---

    // --- START: ATTACH NOTES ---
    processedDriversForDate.forEach(driver => {
        const noteKey = `${driver.name}_${selectedDate}`;
        if (allWeeklyNotes[noteKey]) {
            driver.weeklyNote = allWeeklyNotes[noteKey];
        } else {
            driver.weeklyNote = ''; // Ensure the property exists
        }
    });
    // --- END: ATTACH NOTES ---

    // --- START: ATTACH LOCKS ---
    processedDriversForDate.forEach(driver => {
        const lockKey = `${driver.id}_${selectedDate}`;
        const lockedJSON = allLockedData[lockKey];

        if (lockedJSON) {
            // This week is locked!
            // 1. Parse the saved snapshot
            const lockedData = JSON.parse(lockedJSON);

            // 2. Get properties we need to preserve from the live object
            // (in case they weren't in the snapshot)
            const originalId = driver.id;
            const originalNote = driver.weeklyNote; // from previous step
            
            // 3. Overwrite the live driver object with the snapshot
            Object.assign(driver, lockedData);

            // 4. Restore the preserved properties
            driver.id = originalId;
            driver.weeklyNote = originalNote;
            // FIX: We do NOT restore 'isDispatcherReviewed' from live calc. 
            // We assume the value in 'lockedData' (the snapshot) is the correct, frozen status.
            
            // 5. Set the lock flag
            driver.isLocked = true;
        } else {
            // This week is not locked
            driver.isLocked = false;
        }
    });
    // --- END: APPLY SNAPSHOTS (LOCKS) ---
}

function initDispatcherView(
    currentUser, 
    initialWeeklyNotes, 
    initialLockedData, 
    allDrivers,
    mileageData,      // <-- NEW
    allSafetyData,    // <-- NEW
    daysTakenHistory, // <-- NEW
    dispatcherOverrides // <-- NEW
) {
    // --- STATE MANAGEMENT ---
    let allDriverData = {};
    let allPayDates = [];
    let savedOverrides = {};
    let currentOverrides = {};
    let selectedDriverName = null;
    let isTutorialMode = false;
    let weeklyNotes = initialWeeklyNotes;
    let weeklyLocks = initialLockedData;

    // --- DOM ELEMENTS ---
    const searchInput = document.getElementById('dispatcher-driver-search');
    const payDateSelect = document.getElementById('dispatcher-pay-date-select');
    const driverListContainer = document.getElementById('driver-list-container');
    const activityArea = document.getElementById('activity-confirmation-area');
    const saveFooter = document.getElementById('save-footer');
    const actionButton = document.getElementById('action-btn');
    const editButton = document.getElementById('edit-btn');
    const cancelButton = document.getElementById('cancel-btn');
    const verifiedMessage = document.getElementById('verified-message');
    const toastContainer = document.getElementById('toast-container');
    const noteArea = document.getElementById('note-area');
    const noteInput = document.getElementById('weekly-note-input');
    const saveNoteBtn = document.getElementById('save-note-btn');


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

    // --- THIS FUNCTION IS NO LONGER NEEDED ---
    // async function fetchData(url, resourceName) { ... }
    // --- (DELETED) ---

    function processAllData(driverList, mileageData, samsaraData, changelogData) {
        const drivers = {};
        const payDates = new Set();
        const formatDate = date => date ? new Date(date).toISOString().split('T')[0] : null;

        driverList.forEach(row => {
            // --- FIX: Use .name and .dispatcher ---
            const driverName = row.name; 
            const dispatcher = row.dispatcher;
            // --- END FIX ---
            
            if (row.contract_type !== 'TPOG') return;
            if (!driverName) return;
            // --- FIX: Use dispatcher variable ---
            drivers[driverName] = { name: driverName, dispatcher: dispatcher, team: row.team, activity: {} };
            // --- END FIX ---
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
                // TUTORIAL FIX: Bypass access control when in tutorial mode.
                if (!isTutorialMode && currentUser && currentUser.role && currentUser.role.trim() !== 'Admin') {
                    const userAccessList = String(currentUser.access || '').split(',').map(item => item.trim());
                    const userRole = currentUser.role.trim();
                    let hasAccess = false;
                    if (userRole === 'Dispatcher' && userAccessList.includes(d.dispatcher)) hasAccess = true;
                    else if (userRole === 'Team' && userAccessList.includes(d.team)) hasAccess = true;
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
        const selectedDateStr = payDateSelect.value;
        
        // --- LOCK CHECK ---
        const driverObj = allDrivers.find(d => d.name === selectedDriverName && d.pay_date.split('T')[0] === selectedDateStr);
        const driverId = driverObj ? driverObj.id : null;
        const lockKey = `${driverId}_${selectedDateStr}`;
        const isLocked = !!weeklyLocks[lockKey];
        const isAdmin = currentUser && currentUser.role.trim() === 'Admin';

        if (isLocked) {
            let lockMessage = `
                <div class="p-6 bg-slate-800 rounded-lg text-center text-slate-400 border border-slate-700">
                    <svg class="mx-auto h-12 w-12 text-slate-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clip-rule="evenodd" />
                    </svg>
                    <h3 class="mt-2 text-lg font-medium text-white">Week Locked</h3>
                    <p class="mt-1 text-sm">This week has been locked and cannot be edited.</p>`;
            
            if (isAdmin) {
                lockMessage += `<p class="mt-3 text-xs">As an Admin, you can unlock this week from the main table's "Actions" column.</p>`;
            }
            lockMessage += `</div>`;
            
            activityArea.innerHTML = lockMessage;
            noteArea.classList.add('hidden');
            saveFooter.classList.add('hidden');
            return; // Stop rendering
        }
        // --- END LOCK CHECK ---

        currentOverrides = {};
        const driver = allDriverData[selectedDriverName];
        // const selectedDateStr = payDateSelect.value; // Already defined above
        const monday = new Date(selectedDateStr + 'T12:00:00Z');
        monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
        const tuesday = new Date(monday);
        tuesday.setUTCDate(monday.getUTCDate() - 6);

        const isWeekVerified = Array.from({ length: 7 }).every((_, i) => {
            const day = new Date(tuesday);
            day.setUTCDate(tuesday.getUTCDate() + i);
            return !!savedOverrides[`${driver.name}_${day.toISOString().split('T')[0]}`];
        });

        // --- NEW: Options without CORRECT ---
        const statusOptions = ['ACTIVE', 'DAY_OFF', 'WITHOUT_LOAD', 'NOT_STARTED', 'CONTRACT_ENDED'];
        
        let weekHtml = `
            <div>
                <h2 class="text-xl font-semibold text-white mb-4">Confirm Activity for ${selectedDriverName}</h2>
                <div class="grid grid-cols-7 gap-3">`;

        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(tuesday);
            currentDay.setUTCDate(tuesday.getUTCDate() + i);
            const dayString = currentDay.toISOString().split('T')[0];
            const dayData = driver.activity[dayString] || { prologMiles: 0, systemStatus: 'NO DATA' };
            
            // --- NEW: Determine Default Selection ---
            // 1. Normalize system status (e.g. "DAY OFF" -> "DAY_OFF")
            let systemStatusNormalized = (dayData.systemStatus || '').replace(/ /g, '_');
            
            // 2. Map irregular system statuses to a valid option
            if (!statusOptions.includes(systemStatusNormalized)) {
                if (systemStatusNormalized.includes('ACTIVE')) systemStatusNormalized = 'ACTIVE';
                else if (systemStatusNormalized.includes('DAY_OFF')) systemStatusNormalized = 'DAY_OFF';
                else systemStatusNormalized = 'ACTIVE'; // Fallback
            }

            // 3. Check for saved override
            const savedStatus = savedOverrides[`${selectedDriverName}_${dayString}`];
            
            // 4. Determine what should be selected in the UI
            // If saved as 'CORRECT' (legacy), we show the system status.
            // If saved as specific status, we show that.
            // If not saved, we show system status.
            let selectedValue = savedStatus;
            if (!selectedValue || selectedValue === 'CORRECT') {
                selectedValue = systemStatusNormalized;
            }
            // ----------------------------------------

            // Logic to color the card (If saved and explicit, show green. If just CORRECT legacy, show standard)
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
                            ${statusOptions.map(opt => `<option value="${opt}" ${selectedValue === opt ? 'selected' : ''}>${opt.replace(/_/g, ' ')}</option>`).join('')}
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
            noteInput.disabled = true; // <-- ADDED
        } else {
            actionButton.classList.remove('hidden');
            cancelButton.classList.add('hidden');
            verifiedMessage.classList.add('hidden');
            editButton.classList.add('hidden');
            noteInput.disabled = false; // <-- ADDED
            updateButtonState();
        }
        saveFooter.classList.remove('hidden');

        // Show and populate the note area
        const noteKey = `${selectedDriverName}_${selectedDateStr}`;
        noteInput.value = weeklyNotes[noteKey] || '';
        noteArea.classList.remove('hidden');
        // saveNoteBtn.disabled = false; // <-- REMOVED
        // saveNoteBtn.textContent = 'Save Note'; // <-- REMOVED
    }

    async function saveOverrides(overridesToSave, noteData) { // <-- MODIFIED SIGNATURE
        actionButton.disabled = true;
        actionButton.textContent = 'Saving...';
        editButton.disabled = true;

        if (isTutorialMode) {
            saveDummyOverrides(overridesToSave);
            // --- NEW: "Save" dummy note ---
            const noteKey = `${noteData.driverName}_${noteData.payDate}`;
            if (noteData.noteText) {
                weeklyNotes[noteKey] = noteData.noteText;
            } else {
                delete weeklyNotes[noteKey];
            }
            // --- END NEW ---
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
            // --- Create both promises (Now both using Supabase) ---
            // 1. Save Overrides
            const overridePromise = api.saveDispatcherOverrides(overridesToSave);
    
            // 2. Save Note
            const notePromise = api.saveWeeklyNote(noteData.driverName, noteData.payDate, noteData.noteText);
            
            // --- Wait for both to complete ---
            await Promise.all([overridePromise, notePromise]);

            showToast('Confirmation and note saved successfully!', 'success');
            
            // --- Update local override cache ---
            overridesToSave.forEach(ov => {
                savedOverrides[`${ov.driverName}_${ov.date}`] = ov.status;
            });
            currentOverrides = {};

            // --- NEW: Update local and global note cache ---
            const noteKey = `${noteData.driverName}_${noteData.payDate}`;
            if (noteData.noteText) {
                weeklyNotes[noteKey] = noteData.noteText; // Update view's local cache
                allWeeklyNotes[noteKey] = noteData.noteText; // Update global cache
            } else {
                delete weeklyNotes[noteKey];
                delete allWeeklyNotes[noteKey];
            }
            // --- START: HIGH-PERFORMANCE UPDATE (v2 - Preserves Percentiles) ---
            // Find the driver in both the "base" list and "processed" list
            const driverInBaseList = driversForDate.find(d => d.name === noteData.driverName && d.pay_date.split('T')[0] === noteData.payDate);
            const driverInProcessedList = processedDriversForDate.find(d => d.name === noteData.driverName && d.pay_date.split('T')[0] === noteData.payDate);

            if (driverInBaseList && driverInProcessedList) {
                
                // 1. Store the *correct, old* data we need to preserve
                const originalMpgPercentile = driverInProcessedList.mpgPercentile;
                const originalSpeedingPercentile = driverInProcessedList.speedingPercentile;
                const originalSafetyScore = driverInProcessedList.safetyScore;
                const originalMpg = driverInProcessedList.mpg;
                const originalSpeedingAlerts = driverInProcessedList.speedingAlerts;
                // (and any other raw data fields that get reset)

                // 2. Run the "Weeks Out" calculation on the *base* driver.
                // This will incorrectly set percentiles to 0 on the 'recalculatedDriver' object,
                // but we only want its activity data.
                const [recalculatedDriver] = calc.processDriverDataForDate(
                    [driverInBaseList], 
                    mileageIndex, 
                    settings, 
                    safetyIndex, 
                    overriddenDistances, 
                    daysTakenIndex, 
                    savedOverrides,
                    allDrivers
                );

                // 3. Apply ONLY the activity-related metrics to our live "processed" driver
                driverInProcessedList.weeksOut = recalculatedDriver.weeksOut;
                driverInProcessedList.offDays = recalculatedDriver.offDays;
                driverInProcessedList.balanceAtStartOfWeek = recalculatedDriver.balanceAtStartOfWeek;
                driverInProcessedList.streakAtStartOfWeek = recalculatedDriver.streakAtStartOfWeek;
                driverInProcessedList.isDispatcherReviewed = recalculatedDriver.isDispatcherReviewed;
                driverInProcessedList.weeklyActivity = recalculatedDriver.weeklyActivity;
                driverInProcessedList.weeklyNote = noteData.noteText; // Add the note

                // 4. Restore the *correct, old* data, overwriting the 0s from step 2
                driverInProcessedList.mpgPercentile = originalMpgPercentile;
                driverInProcessedList.speedingPercentile = originalSpeedingPercentile;
                driverInProcessedList.safetyScore = originalSafetyScore;
                driverInProcessedList.mpg = originalMpg;
                driverInProcessedList.speedingAlerts = originalSpeedingAlerts;

                // 5. Now, re-calculate the final report (Bonuses, Penalties, Final %)
                // The driver object now has the *new* Weeks Out but the *old* (correct) percentiles.
                const newReportData = calc.getDriverReportData(driverInProcessedList, settings, processedDriversForDate);
                
                // 6. Apply the new report data (Bonuses, Final %, Escrow)
                // This function does not touch percentiles, so they are safe.
                Object.assign(driverInProcessedList, newReportData);

                // 7. Re-render the main table. This will be instant and correct.
                filterAndRenderTable();

            } else {
                // Fallback to the slow method if the driver wasn't found
                console.warn("Driver not found in lists, falling back to full refresh.");
                processDataForSelectedDate();
                filterAndRenderTable();
            }
            // --- END: HIGH-PERFORMANCE UPDATE (v2) ---

            // Re-render the local dispatcher view
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
        noteArea.classList.add('hidden');
        renderDriverList();
        renderActivityView();
    }

    // --- THIS IS THE FINAL KEY CHANGE ---
    // This 'init' function no longer fetches data (unless in tutorial mode)
    async function init(forceTutorial = false) {
        const tutorialSeen = localStorage.getItem('dispatcherTutorialSeen');
        isTutorialMode = forceTutorial || !tutorialSeen;

        ui.showLoadingOverlay();

        if (isTutorialMode) {
            const dummy = generateDummyData();
            allDriverData = dummy.allDriverData;
            allPayDates = dummy.allPayDates;
            savedOverrides = getDummyOverrides();
        } else {
            clearDummyStorage();
            
            // --- REPLACED ALL FETCHES ---
            // Use the data passed into initDispatcherView from the main app
            
            // 1. Use the globally-loaded overrides
            // (dispatcherOverrides is already the map we need)
            savedOverrides = dispatcherOverrides;

            // 2. Use the globally-loaded notes and locks
            // (These are already assigned at the top of initDispatcherView)

            // 3. Process the globally-loaded data
            allDriverData = processAllData(allDrivers, mileageData, allSafetyData, daysTakenHistory);
            // --- END OF REPLACEMENT ---
        }
        
        payDateSelect.innerHTML = allPayDates.map(date => `<option value="${date}">${date}</option>`).join('');
        payDateSelect.disabled = false;

        ui.hideLoadingOverlay();

        if (isTutorialMode) {
            startTutorial(() => init(false));
        }
    }

    // --- EVENT LISTENERS ---
    searchInput.addEventListener('input', renderDriverList);
    payDateSelect.addEventListener('change', () => {
        selectedDriverName = null;
        activityArea.innerHTML = '<p class="text-slate-500">Select a driver from the list to begin confirmation.</p>';
        saveFooter.classList.add('hidden');
        noteArea.classList.add('hidden'); // Hide note area when date changes
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
        
        const overrides = weekDays.map(date => {
            // Robustly find the dropdown by attribute
            const selectEl = document.querySelector(`.status-select[data-date="${date}"]`);
            // Ensure we get the value, trim it, and default to ACTIVE only if absolutely necessary
            const status = selectEl ? selectEl.value.trim() : 'ACTIVE';
            return { date, driverName: selectedDriverName, status };
        });

        // --- NEW NOTE LOGIC ---
        const noteData = {
            driverName: selectedDriverName,
            payDate: payDateSelect.value,
            noteText: noteInput.value
        };
        // --- END NEW NOTE LOGIC ---

        saveOverrides(overrides, noteData); // Pass both
    });

    editButton.addEventListener('click', () => {
        activityArea.querySelectorAll('.status-select').forEach(sel => sel.disabled = false);
        noteInput.disabled = false; // <-- ADDED
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
        init(true);
    });

    // --- REMOVED saveNoteBtn.addEventListener('click', ...) ---

    init(); // Initial Load
}

// ----------------------------------------------
// --- ARCHIVE VIEW LOGIC (ALL-AT-ONCE) ---
// ----------------------------------------------
let allArchivedData = []; // This will store the data loaded at once
let allAppDrivers = []; // To store allDrivers for feedback modal
let selectedArchivedDriverId = null;
let archiveCharts = {
// ... (this object already exists) ...
};
let currentDriverFeedback = [];
let archiveSortColumn = 'name'; // Default sort by name
let archiveSortDirection = 'asc';

// --- ADD THE NEW DEFINITIONS BELOW ---
let allFranchises = [];
let allTeams = [];

const archiveFilterableColumns = {
    'name': { title: 'Driver Name', type: 'string' },
    'mileage': { title: 'Mileage', type: 'numeric' }, // ADDED
    'safetyScore': { title: 'Safety Score', type: 'numeric' }, // ADDED
    'score': { title: 'Score', type: 'numeric' },
    'medianGross': { title: 'Median Gross', type: 'numeric' },
    'medianMiles': { title: 'Median Miles', type: 'numeric' },
    'lastBalance': { title: 'Last Balance', type: 'numeric' },
    'lastPO': { title: 'Last PO', type: 'numeric' },
    'lastEscrow': { title: 'Last Escrow', type: 'numeric' },
    'franchise': { title: 'Franchise', type: 'string_select' },
    'team': { title: 'Team', type: 'string_select' },
    'status': { title: 'Status', type: 'string_select' },
    'statusDate': { title: 'Termination Date', type: 'date' },
    'hasSafety': { title: 'Safety Data', type: 'boolean' },
    'hasNote': { title: 'Has Note', type: 'boolean' }
};

const archiveFilterOperators = {
    'numeric': [
        { value: 'is', text: 'is' },
        { value: 'is_not', text: 'is not' },
        { value: 'is_more_than', text: '>' },
        { value: 'is_less_than', text: '<' },
        { value: 'is_more_or_equal', text: '>=' },
        { value: 'is_less_or_equal', text: '<=' }
    ],
    'string': [
        { value: 'contains', text: 'contains' },
        { value: 'does_not_contain', text: 'does not contain' }
    ],
    'string_select': [
        { value: 'is', text: 'is' },
        { value: 'is_not', text: 'is not' },
        { value: 'is_any_of', text: 'is any of' },
        { value: 'is_not_any_of', text: 'is not any of' }
    ],
    'boolean': [
        { value: 'exists', text: 'exists' },
        { value: 'does_not_exist', text: 'does not exist' }
    ],
    'date': [ 
        { value: 'is_in_last', text: 'in the last' },
        { value: 'is_not_in_last', text: 'not in the last' },
        { value: 'is_before_last', text: 'before the last' },
        { value: 'is_on', text: 'is on (YYYY-MM-DD)' },
        { value: 'is_not_on', text: 'is not on (YYYY-MM-DD)' },
        { value: 'is_after', text: 'is after (YYYY-MM-DD)' },
        { value: 'is_before', text: 'is before (YYYY-MM-DD)' }
    ]
};
// --- END OF NEW DEFINITIONS ---

/**
 * Initializes all event listeners for the archive view.
 * @param {Array} allDriversData - Passed in from main.js
 */
// REPLACE FROM LINE 1332 TO THE END OF THE FILE
function initArchiveView(allDriversData) {
    allAppDrivers = allDriversData; // Store for later use

    // --- New Filter Listeners ---
    document.getElementById('archive-search').addEventListener('input', debounce(renderArchiveTable, 300));
    
    document.getElementById('archive-filter-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('archive-filter-panel').classList.toggle('hidden');
    });

    document.getElementById('archive-filter-clear').addEventListener('click', () => {
        // FIX: This now clears all rows instead of leaving one
        document.getElementById('archive-filter-rows-container').innerHTML = '';
        renderArchiveTable();
    });

    document.getElementById('archive-add-filter-btn').addEventListener('click', addArchiveFilterRow);

    document.querySelectorAll('input[name="archive-filter-logic"]').forEach(radio => {
        radio.addEventListener('change', renderArchiveTable);
    });

    const filterRowsContainer = document.getElementById('archive-filter-rows-container');
    filterRowsContainer.addEventListener('change', e => {
        const target = e.target;
        const filterRow = target.closest('.archive-filter-row');
        if (!filterRow) return;

        if (target.matches('.archive-filter-column')) {
            // Column changed: update operators, THEN update value field
            updateArchiveOperatorList(filterRow);
            updateArchiveValueField(filterRow);
        } else if (target.matches('.archive-filter-operator')) {
            // Operator changed: ONLY update value field
            updateArchiveValueField(filterRow);
        }
        
        // Debounce the table render
        debounce(renderArchiveTable, 300)();
    });

    filterRowsContainer.addEventListener('click', e => {
        if (e.target.closest('.remove-archive-filter-btn')) {
            e.target.closest('.archive-filter-row').remove();
            renderArchiveTable();
        }
    });
    
    filterRowsContainer.addEventListener('input', e => {
        if (e.target.matches('.archive-filter-value')) {
            debounce(renderArchiveTable, 300)();
        }
    });

    // Global click to close filter panel
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#archive-filter-panel') && !e.target.closest('#archive-filter-btn')) {
            document.getElementById('archive-filter-panel').classList.add('hidden');
        }
    });
    // --- End New Filter Listeners ---

    // --- NEW: Header Sort Listener ---
    const archiveTableHead = document.querySelector('#archive-table-body').closest('table').querySelector('thead');
    archiveTableHead.addEventListener('click', e => {
        const header = e.target.closest('th[data-sort-key]');
        if (!header) return;

        const newSortColumn = header.dataset.sortKey;
        if (newSortColumn === archiveSortColumn) {
            // Toggle direction
            archiveSortDirection = archiveSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            // Set new column, default to asc
            archiveSortColumn = newSortColumn;
            archiveSortDirection = 'asc';
        }
        
        // Re-render the table by calling renderArchiveTable with the new sort state
        renderArchiveTable();
    });
    // --- END NEW ---

    document.getElementById('archive-table-body').addEventListener('click', e => {
        const row = e.target.closest('tr[data-driver-id]');
        if (row) {
            selectArchivedDriver(row.dataset.driverId);
        }
    });

    document.getElementById('archive-detail-area').addEventListener('click', async e => { // <-- Make this async
        const tab = e.target.closest('.archive-tab');
        if (tab) {
            switchArchiveTab(tab.dataset.tab);
        }
        if (e.target.id === 'archive-request-feedback-btn') {
            openFeedbackRequestModal();
        }
        // New listener for the chat-style send button
        if (e.target.closest('#archive-send-note-btn')) {
            const input = document.getElementById('archive-note-input');
            const noteText = input.value.trim();
            if (noteText) {
                // Call our new, simplified send function
                sendChatNote(noteText); 
                input.value = ''; // Clear the input
            }
        }

        // --- [NEW] Handle Edit Button Click ---
        if (e.target.id === 'archive-status-edit') {
            e.stopPropagation(); // Stop the event from bubbling
            document.getElementById('archive-status-buttons').classList.remove('hidden');
            e.target.classList.add('hidden');
        }
        // --- [END NEW] ---

        // --- [NEW] Handle Status Change Buttons ---
        let newStatus = null;
        let isDanger = false;
        
        const rehireYesBtn = e.target.closest('#archive-rehire-yes');
        const rehireNoBtn = e.target.closest('#archive-rehire-no');

        if (rehireYesBtn) {
            newStatus = 'Rehireable';
            isDanger = false;
        } else if (rehireNoBtn) {
            newStatus = 'Do Not Rehire';
            isDanger = true;
        }

        if (newStatus) {
            if (!selectedArchivedDriverId) return;
            const driver = allArchivedData.find(d => d.id == selectedArchivedDriverId);
            if (!driver) return;

            const confirmed = await ui.showCustomConfirm(
                `Confirm Status Change`,
                `Are you sure you want to set ${driver.name}'s status to "${newStatus}"?`,
                { confirmText: 'Confirm', isDanger: isDanger }
            );

            if (!confirmed) return;

            ui.showLoadingOverlay();

            // We re-use the feedback API to send this new status.
            // We also add a note to log who made the change.
            const feedbackData = {
                status: newStatus,
                note: `Status updated to ${newStatus}.`
            };

            const result = await api.submitDriverFeedback(selectedArchivedDriverId, feedbackData, currentUser);

            // --- REVISED LOGIC ---
            if (result.status === 'success') {
                // 1. Update the driver's base status string locally.
                // The realtime listener will add the note, but this updates the header.
                const newStatusString = `${newStatus} (${new Date().toISOString().split('T')[0]})`;
                driver.profile.status = newStatusString; // Update main data array
                driver.computedStatus = newStatus; // Update the computed status for sorting
                
                // 2. Let the realtime listener handle ALL UI updates (notes, scores, etc.)
                // We just show a success message.
                
                // 3. Manually re-render the profile header and table row
                // to show the new status *immediately* for the clicker.
                renderDriverProfile(driver); 
                renderArchiveTable();

                ui.hideLoadingOverlay();
                ui.showCustomAlert('Status updated successfully!', 'Success');
            } else {
                ui.hideLoadingOverlay();
                ui.showCustomAlert(`Failed to update status: ${result.message}`, 'Error');
            }
        }
        // --- [END NEW] ---
    });

    // Feedback Modal Listeners
    document.getElementById('feedback-modal-close-btn').addEventListener('click', closeFeedbackRequestModal);
    document.getElementById('feedback-modal-btn-cancel').addEventListener('click', closeFeedbackRequestModal);
    document.getElementById('feedback-request-modal').addEventListener('click', (e) => {
        if (e.target.id === 'feedback-request-modal') closeFeedbackRequestModal();
    });
    document.getElementById('feedback-modal-btn-generate').addEventListener('click', generateFeedbackLink);

    // Link Modal Listeners
    document.getElementById('feedback-link-modal-close-btn').addEventListener('click', closeFeedbackLinkModal);
    document.getElementById('feedback-link-modal-close-btn-footer').addEventListener('click', closeFeedbackLinkModal);
    document.getElementById('feedback-link-modal').addEventListener('click', (e) => {
        if (e.target.id === 'feedback-link-modal') closeFeedbackLinkModal();
    });
    document.getElementById('feedback-copy-link-btn').addEventListener('click', () => {
        const linkInput = document.getElementById('feedback-generated-link');
        linkInput.select(); 
        navigator.clipboard.writeText(linkInput.value);
        ui.showToast('Link copied to clipboard!');
    });

    
    tooltipHandler(event, document.getElementById('archive-table-body')); // Add tooltip support for archive list

    // --- ADD THIS LINE ---
    listenForLiveUpdates();
    
    // This is the "load all at once" logic
    loadAndRenderAllArchiveData();
}

// --- ADD THIS ENTIRE NEW FUNCTION BLOCK ---
let noteListenerSubscribed = false;

function listenForLiveUpdates() {
    // Only subscribe one time
    if (noteListenerSubscribed) return;

    console.log('Subscribing to live notes...');
    noteListenerSubscribed = true;

    supabase
        .channel('public-notes-feed') // A name for this "phone line"
        .on(
            'postgres_changes', // Tell Supabase we want to listen for database changes
            { 
                event: 'INSERT',      // We only care about *new* notes
                schema: 'public',
                table: 'notes'        // From the `notes` table we created
            },
            (payload) => {
                // This code runs when a new note arrives!
                console.log('Live note received!', payload.new);
                const newNote = payload.new;

                // 1. Find the driver in our master data list
                const driverToUpdate = allArchivedData.find(d => d.id === newNote.driver_id);
                
                if (driverToUpdate) {
                    // 2. Format the new note to match what our app expects
                    const formattedNote = {
                        date: newNote.created_at,
                        note: newNote.note,
                        from: newNote.author_email,
                        role: newNote.author_role,
                        // (score fields will be empty, which is correct for a note)
                    };

                    // 3. Add the new note to their feedback array
                    if (!driverToUpdate.feedback) {
                        driverToUpdate.feedback = [];
                    }
                    driverToUpdate.feedback.push(formattedNote);

                    // 4. Update the UI *if* we are currently looking at this driver
                    if (driverToUpdate.id === selectedArchivedDriverId) {
                        currentDriverFeedback = driverToUpdate.feedback;
                        renderDriverProfile(driverToUpdate); // Re-renders the note list
                    }

                    // 5. Re-render the main table to show the new note icon
                    renderArchiveTable();
                }
            }
            )
        
            // --- ADD THIS ENTIRE NEW BLOCK ---
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'feedback' // This listens to the NEW 'feedback' table
                },
                (payload) => {
                    console.log('Live FEEDBACK received!', payload.new);
                    const newFeedback = payload.new;
    
                    // 1. Find the driver in our master data list
                    const driverToUpdate = allArchivedData.find(d => d.id === newFeedback.driver_id);
                    if (!driverToUpdate) return; // Driver not in our list
 
                    // --- NEW LOGIC: Handle BOTH event types ---
                    let formattedItem;
                    if (newFeedback.overall_score === null) {
                        // This is an internal status update (like "Rehireable")
                        // Format it like a simple NOTE
                        formattedItem = {
                            date: newFeedback.created_at,
                            note: newFeedback.note,
                            from: newFeedback.author_role, // 'Admin', 'Onboarder', etc.
                            role: newFeedback.author_role,
                        };
                    } else {
                        // This is a full public survey
                        // Format it as FEEDBACK
                        formattedItem = {
                            date: newFeedback.created_at,
                            note: newFeedback.note,
                            from: `Feedback Form`,
                            role: newFeedback.author_role,
                            coachable: newFeedback.coachable,
                            hustle: newFeedback.hustle,
                            communication: newFeedback.communication,
                            score: newFeedback.overall_score,
                            terms: newFeedback.terms,
                            rehire: newFeedback.rehire
                        };
    
                        // 4. Re-calculate the driver's average score (only for full surveys)
                        if (!driverToUpdate.feedback) driverToUpdate.feedback = [];
                        const existingScores = driverToUpdate.feedback.map(item => item.score).filter(s => s !== null && s !== undefined && s !== "");
                        const allScores = [...existingScores, newFeedback.overall_score];
                        
                        if (allScores.length > 0) {
                            const totalScore = allScores.reduce((sum, score) => sum + parseFloat(score), 0);
                            driverToUpdate.score = (totalScore / allScores.length);
                        } else {
                            driverToUpdate.score = 0;
                        }
                    }
                    // --- END NEW LOGIC ---
    
                    // 3. Add the new item (either note or feedback) to their array
                    if (!driverToUpdate.feedback) {
                        driverToUpdate.feedback = [];
                    }
                    driverToUpdate.feedback.push(formattedItem);
    
                    // 5. Update the UI *if* we are currently looking at this driver
                    if (driverToUpdate.id === selectedArchivedDriverId) {
                        currentDriverFeedback = driverToUpdate.feedback;
                        renderDriverProfile(driverToUpdate); // Re-renders the note/feedback list
                    }
    
                    // 6. Re-render the main table (to show new score or note icon)
                    renderArchiveTable();
                }
            
            )
            // --- END OF NEW BLOCK ---
    
            .subscribe();
    }
// --- END OF NEW FUNCTION BLOCK ---


// --- START: New Archive Filter Helper Functions ---

function getArchiveFilterableColumnOptions() {
    return Object.entries(archiveFilterableColumns)
        .map(([key, { title }]) => `<option value="${key}">${title}</option>`)
        .join('');
}

function getArchiveOperatorOptions(type) {
    const operators = archiveFilterOperators[type] || archiveFilterOperators['string'];
    return operators.map(op => `<option value="${op.value}">${op.text}</option>`).join('');
}

function getArchiveFilterValueFieldHTML(columnKey, operator) {
    const column = archiveFilterableColumns[columnKey];
    if (!column) {
        return ''; // Should not happen
    }

    if (column.type === 'boolean') {
         return `<input type="text" class="archive-filter-value" style="display: none;">`;
    }

    if (column.type === 'date') {
        if (operator === 'is_in_last' || operator === 'is_not_in_last' || operator === 'is_before_last') {
            // Show a number input and a week/month/year select
            return `
                <div class="grid grid-cols-2 gap-2">
                <input type="number" class="archive-filter-value settings-input !bg-slate-700 !text-slate-200 !text-sm !py-1 w-full" placeholder="e.g. 6">
                <select class="archive-filter-value-unit settings-input !bg-slate-700 !text-slate-200 !text-sm !py-1 w-full">
                        <option value="weeks">weeks</option>
                        <option value="days">days</option>
                        <option value="months">months</option>
                    </select>
                </div>
            `;
        } else {
            // Show a simple text input for YYYY-MM-DD
            return `<input type="text" class="archive-filter-value settings-input !bg-slate-700 !text-slate-200 !text-sm !py-1 w-full" placeholder="YYYY-MM-DD">`;
        }
    }

    if (column.type === 'string_select') {
        let options = [];
        if (columnKey === 'franchise') {
            options = allFranchises;
        } else if (columnKey === 'team') {
            options = allTeams;
        } else if (columnKey === 'status') {
            // FIX: Added "Rehireable"
            options = ['Terminated', 'Active', 'Do Not Rehire', 'Rehireable'];
        }

        const isMulti = operator === 'is_any_of' || operator === 'is_not_any_of';
        const optionsHtml = options.map(value => `<option value="${value}">${value}</option>`).join('');
        return `<select class="archive-filter-value settings-input !bg-slate-700 !text-slate-200 !text-sm !py-1 w-full" ${isMulti ? 'multiple' : ''}>${optionsHtml}</select>`;
    }
    
    // Default for 'numeric' and 'string'
    let placeholder = 'Filter value';
    if (operator === 'is_any_of' || operator === 'is_not_any_of') {
        placeholder = 'e.g. value1, value2';
    }
    return `<input type="text" class="archive-filter-value settings-input !bg-slate-700 !text-slate-200 !text-sm !py-1 w-full" placeholder="${placeholder}">`;
}

/**
 * Updates the list of available operators based on the selected column.
 */
function updateArchiveOperatorList(filterRow) {
    const columnSelect = filterRow.querySelector('.archive-filter-column');
    const operatorSelect = filterRow.querySelector('.archive-filter-operator');
    const columnKey = columnSelect.value;
    const columnType = archiveFilterableColumns[columnKey].type;
    
    // Update operator list
    operatorSelect.innerHTML = getArchiveOperatorOptions(columnType);
}

/**
 * Updates the value input field based on the selected column and operator.
 */
function updateArchiveValueField(filterRow) {
    const columnSelect = filterRow.querySelector('.archive-filter-column');
    const operatorSelect = filterRow.querySelector('.archive-filter-operator');
    const valueContainer = filterRow.querySelector('.archive-filter-value-container');
    
    const columnKey = columnSelect.value;
    const operator = operatorSelect.value; // This now correctly reads the user's selection

    // Update value field
    valueContainer.innerHTML = getArchiveFilterValueFieldHTML(columnKey, operator);
}

function addArchiveFilterRow() {
    const container = document.getElementById('archive-filter-rows-container');
    const filterRow = document.createElement('div');
    filterRow.className = 'archive-filter-row grid grid-cols-[auto_auto_1fr_auto] gap-2 items-center text-sm';
    
    const defaultColumn = Object.keys(archiveFilterableColumns)[0];
    const defaultType = archiveFilterableColumns[defaultColumn].type;
    const defaultOperator = archiveFilterOperators[defaultType][0].value;

    filterRow.innerHTML = `
        <div>
            <select class="archive-filter-column settings-input !bg-slate-700 !text-slate-200 !text-sm !py-1 w-full">
                ${getArchiveFilterableColumnOptions()}
            </select>
        </div>
        <div>
            <select class="archive-filter-operator settings-input !bg-slate-700 !text-slate-200 !text-sm !py-1 w-full">
                ${getArchiveOperatorOptions(defaultType)}
            </select>
        </div>
        <div class="archive-filter-value-container">
            ${getArchiveFilterValueFieldHTML(defaultColumn, defaultOperator)}
        </div>
        <button type="button" class="remove-archive-filter-btn text-slate-500 hover:text-red-500 p-1 rounded-full transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
    `;
    container.appendChild(filterRow);
}

// --- END: New Archive Filter Helper Functions ---


/**
 * Fetches ALL archive data at once and renders the list.
 */
async function loadAndRenderAllArchiveData() {
    const tableBody = document.getElementById('archive-table-body');
    ui.showLoadingOverlay();

    try {
        // 1. Fetch all data from Google Sheets AND Supabase at the same time
        const [archiveResult, notesResult, feedbackResult] = await Promise.all([
            api.fetchAllArchiveData(),
            supabase.from('notes').select('*'),
            supabase.from('feedback').select('*')
        ]);

        if (archiveResult.status !== 'success') {
            throw new Error(archiveResult.message);
        }

        allArchivedData = archiveResult.data; // This is the base data

        // 2. Merge all LIVE NOTES from Supabase
        const allNotes = notesResult.data || [];
        allNotes.forEach(note => {
            const driver = allArchivedData.find(d => d.id === note.driver_id);
            if (driver) {
                if (!driver.feedback) driver.feedback = [];
                // Format it like a note
                driver.feedback.push({
                    date: note.created_at,
                    note: note.note,
                    from: note.author_email,
                    role: note.author_role,
                });
            }
        });

        // 3. Merge all LIVE FEEDBACK from Supabase
        const allFeedback = feedbackResult.data || [];
        allFeedback.forEach(fb => {
            const driver = allArchivedData.find(d => d.id === fb.driver_id);
            if (driver) {
                if (!driver.feedback) driver.feedback = [];
                // Format it like feedback
                driver.feedback.push({
                    date: fb.created_at,
                    note: fb.note,
                    from: `Feedback Form`,
                    role: fb.author_role,
                    coachable: fb.coachable,
                    hustle: fb.hustle,
                    communication: fb.communication,
                    score: fb.overall_score,
                    terms: fb.terms,
                    rehire: fb.rehire
                });
            }
        });

        // 4. Re-calculate scores for ALL drivers now that data is merged
        allArchivedData.forEach(driver => {
            if (driver.feedback && driver.feedback.length > 0) {
                const scores = driver.feedback.map(item => item.score).filter(s => s !== null && s !== undefined && s !== "");
                if (scores.length > 0) {
                    const totalScore = scores.reduce((sum, score) => sum + parseFloat(score), 0);
                    driver.score = (totalScore / scores.length); // This is the 1-10 average
                } else {
                    driver.score = 0; // Has notes but no scores
                }
            } else {
                driver.score = 0; // No feedback at all
            }
        });

        // 5. Populate filter options (like before)
        const franchiseSet = new Set();
        const teamSet = new Set();
        allArchivedData.forEach(driver => {
            driver.profile.affiliations.franchises.forEach(f => franchiseSet.add(f));
            driver.profile.affiliations.teams.forEach(t => teamSet.add(t));
        });
        allFranchises = [...franchiseSet].sort();
        allTeams = [...teamSet].sort();

        // 6. Render the table (like before)
        if (document.querySelectorAll('#archive-filter-rows-container .archive-filter-row').length === 0) {
            addArchiveFilterRow();
        }
        renderArchiveTable(); 

    } catch (error) {
        console.error("Failed to fetch and merge all archive data:", error);
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-red-500">Failed to load drivers: ${error.message}</td></tr>`;
    } finally {
        ui.hideLoadingOverlay();
    }
}


/**
 * Renders the archive table based on search and a dynamic list of filters.
 */
function renderArchiveTable() {
    const tableBody = document.getElementById('archive-table-body');
    const searchTerm = document.getElementById('archive-search').value.toLowerCase();
    const filterLogic = document.querySelector('input[name="archive-filter-logic"]:checked')?.value || 'AND';

    // --- START: Update Table Header ---
    const tableHead = document.querySelector('#archive-table-body').closest('table').querySelector('thead');
    if (tableHead) {
        const getSortArrow = (key) => {
            if (key !== archiveSortColumn) return `<span class="sort-arrow hidden">▲</span>`;
            // Use 'desc' for down arrow (points up when rotated 180deg)
            return `<span class="sort-arrow ${archiveSortDirection}">▲</span>`;
        };

        tableHead.innerHTML = `
            <tr>
                <th class="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left sortable-header" data-sort-key="name">
                    <div class="flex items-center gap-1">Driver ${getSortArrow('name')}</div>
                </th>
                <th class="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center sortable-header" data-sort-key="mileage">
                    <div class="flex items-center justify-center gap-1">Mileage ${getSortArrow('mileage')}</div>
                </th>
                <th class="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center sortable-header" data-sort-key="score">
                    <div class="flex items-center justify-center gap-1">Score ${getSortArrow('score')}</div>
                </th>
                <th class="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center sortable-header" data-sort-key="status">
                    <div class="flex items-center justify-center gap-1">Status ${getSortArrow('status')}</div>
                </th>
            </tr>
        `;
    }
    // --- END: Update Table Header ---

    // 1. Build Filter Rules from UI
    const filterRules = [];
    let isFilterActive = false;
    document.querySelectorAll('#archive-filter-rows-container .archive-filter-row').forEach(row => {
        const column = row.querySelector('.archive-filter-column').value;
        const operator = row.querySelector('.archive-filter-operator').value;
        const valueElement = row.querySelector('.archive-filter-value');
        let value = [];

        if (valueElement) {
            if (valueElement.tagName.toLowerCase() === 'select') {
                value = valueElement.multiple 
                    ? [...valueElement.options].filter(opt => opt.selected).map(opt => opt.value)
                    : (valueElement.value ? [valueElement.value] : []);
            } else if (valueElement.value) {
                if (operator === 'is_any_of' || operator === 'is_not_any_of') {
                    value = valueElement.value.split(',').map(v => v.trim()).filter(Boolean);
                } else {
                    value = [valueElement.value];
                }
            }
        }
        
        const columnType = archiveFilterableColumns[column].type;
        if (columnType === 'date' && (operator === 'is_in_last' || operator === 'is_not_in_last' || operator === 'is_before_last')) {
            const unitElement = row.querySelector('.archive-filter-value-unit');
            if (unitElement) {
                value.push(unitElement.value); // value is now [amount, unit], e.g., ["6", "weeks"]
            }
        }
        
        if (columnType === 'boolean' || (value.length > 0 && value[0] !== '')) {
             filterRules.push({ column, operator, value, type: columnType });
             isFilterActive = true;
        }
    });

    document.getElementById('archive-filter-btn').classList.toggle('filter-active', isFilterActive);

    // 2. Define Rule Evaluator
    const evaluateRule = (driver, rule) => {
        const { column, operator, value, type } = rule;
        
        // --- Get Driver Value ---
        let driverValue;
        let driverBool = false; 
        switch (column) {
            // Profile
            case 'name': driverValue = driver.name; break;
            case 'mileage': driverValue = driver.profile.medianMiles; break;
            // FIX: This now points to the Feedback Score
            case 'score': driverValue = driver.score; break; 
            case 'status': 
                driverValue = driver.computedStatus || 'Terminated';
                break;
            // Profile (Calculated)
            case 'medianGross': driverValue = driver.profile.medianGross; break;
            case 'medianMiles': driverValue = driver.profile.medianMiles; break;
            case 'lastNet': driverValue = driver.profile.lastNet; break;
            case 'lastBalance': driverValue = parseFloat(driver.profile.lastBalance); break;
            case 'lastPO': driverValue = parseFloat(driver.profile.lastPO); break;
            case 'lastEscrow': driverValue = parseFloat(driver.profile.lastEscrow); break;
            // FIX: This now points to maxPayDate
            case 'statusDate':
                const statusString = driver.profile.status || '';
                const dateMatch = statusString.match(/\(([^)]+)\)/); // Finds text in (parentheses)
                driverValue = dateMatch ? dateMatch[1] : null; // Extracts "YYYY-MM-DD"
                break;
            // Affiliations
            case 'franchise': driverValue = driver.profile.affiliations.franchises; break;
            case 'team': driverValue = driver.profile.affiliations.teams; break;
            // Boolean 'Exists' checks
            case 'hasSafety': driverBool = driver.safety.score.some(s => s.y > 0) || driver.safety.speeding.some(s => s.y > 0) || driver.safety.harsh.some(s => s.y > 0); break;
            case 'hasNote': driverBool = driver.feedback && driver.feedback.some(f => f.note); break;
            case 'hasBalance': driverBool = driver.balances.balance.some(b => b.y !== 0); break;
            case 'hasPO': driverBool = driver.balances.po.some(p => p.y > 0); break;
            case 'hasEscrow': driverBool = driver.balances.escrow.some(e => e.y !== 0); break;
            default: return true;
        }

        // --- Evaluate ---
        if (type === 'boolean') {
            return operator === 'exists' ? driverBool : !driverBool;
        }

        if (type === 'numeric') {
            let numDriverValue = parseFloat(driverValue);
            if (driverValue === null || driverValue === undefined || isNaN(numDriverValue)) {
                if (operator === 'is' && parseFloat(value[0]) === 0) {
                    numDriverValue = 0;
                } else {
                    return false; 
                }
            }
            const numValue = parseFloat(value[0]);
            if (isNaN(numValue)) return true; 

            switch (operator) {
                case 'is': return numDriverValue === numValue;
                case 'is_not': return numDriverValue !== numValue;
                case 'is_more_than': return numDriverValue > numValue;
                case 'is_less_than': return numDriverValue < numValue;
                case 'is_more_or_equal': return numDriverValue >= numValue;
                case 'is_less_or_equal': return numDriverValue <= numValue;
                default: return true;
            }
        }

        if (type === 'string') {
            const strDriverValue = String(driverValue || '').toLowerCase();
            const strValue = (value[0] || '').toLowerCase();
            if (operator === 'contains') return strDriverValue.includes(strValue);
            if (operator === 'does_not_contain') return !strDriverValue.includes(strValue);
        }
        
        if (type === 'string_select') {
            const normalizedValues = value.map(v => v.toLowerCase());
            if (Array.isArray(driverValue)) {
                const driverValuesLower = driverValue.map(v => v.toLowerCase());
                const intersection = driverValuesLower.filter(v => normalizedValues.includes(v));
                if (operator === 'is_any_of') return intersection.length > 0;
                if (operator === 'is_not_any_of') return intersection.length === 0;
                if (operator === 'is') return driverValuesLower.includes(normalizedValues[0]);
                if (operator === 'is_not') return !driverValuesLower.includes(normalizedValues[0]);
            } else {
                const strDriverValue = String(driverValue || '').toLowerCase();
                if (operator === 'is') return strDriverValue === normalizedValues[0];
                if (operator === 'is_not') return strDriverValue !== normalizedValues[0];
                if (operator === 'is_any_of') return normalizedValues.includes(strDriverValue);
                if (operator === 'is_not_any_of') return !normalizedValues.includes(strDriverValue);
            }
        }
        if (type === 'date') {
            try {
                const today = new Date();
                const todayTime = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

                if (!driverValue) {
                    if (operator === 'is_not_in_last' || operator === 'is_before_last') {
                        return true;
                    }
                    return false;
                }
                
                const [dYear, dMonth, dDay] = String(driverValue).split('-').map(Number);
                const driverTime = Date.UTC(dYear, dMonth - 1, dDay);

                if (isNaN(driverTime)) return false; 

                if (operator === 'is_in_last' || operator === 'is_not_in_last' || operator === 'is_before_last') {
                    const amount = parseInt(value[0], 10);
                    const unit = value[1] || 'weeks'; 
                    if (isNaN(amount)) return true; 

                    const cutoffDate = new Date(todayTime);
                    if (unit === 'days') {
                        cutoffDate.setUTCDate(cutoffDate.getUTCDate() - amount);
                    } else if (unit === 'weeks') {
                        cutoffDate.setUTCDate(cutoffDate.getUTCDate() - (amount * 7));
                    } else if (unit === 'months') {
                        cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - amount);
                    }
                    
                    const cutoffTime = cutoffDate.getTime();
                    const isWithin = driverTime >= cutoffTime && driverTime <= todayTime;

                    if (operator === 'is_in_last') return isWithin;
                    if (operator === 'is_not_in_last') return !isWithin;
                    if (operator === 'is_before_last') return driverTime < cutoffTime; 
                
                } else {
                    const [fYear, fMonth, fDay] = String(value[0]).split('-').map(Number);
                    if (!fYear || !fMonth || !fDay) return true; 
                    
                    const filterTime = Date.UTC(fYear, fMonth - 1, fDay);
                    if (isNaN(filterTime)) return true; 

                    if (column === 'statusDate') {
                        console.log("--- Date Filter Debug (FIXED) ---");
                        console.log("Driver:", driver.name);
                        console.log("Raw driverValue:", driverValue);
                        console.log("Filter Value:", value[0]);
                        console.log("Driver Timestamp (UTC):", driverTime);
                        console.log("Filter Timestamp (UTC):", filterTime);
                        console.log("IS MATCH:", driverTime === filterTime);
                    }

                    if (operator === 'is_on') return driverTime === filterTime;
                    if (operator === 'is_not_on') return driverTime !== filterTime;
                    if (operator === 'is_after') return driverTime > filterTime;
                    if (operator === 'is_before') return driverTime < filterTime;
                }
            } catch (e) {
                console.warn("Date filter error:", e);
                return false; 
            }
        }
        return true;
    };

    // --- Pre-compute final status for sorting and rendering ---
    allArchivedData.forEach(driver => {
        let finalStatus = (driver.profile.status || 'Terminated').split(' (')[0].trim(); // Default

        if (driver.feedback && driver.feedback.length > 0) {
            // 1. Find all feedback items that are *explicit status updates* from an admin
            const statusFeedbacks = driver.feedback
                .map(f => {
                    let mappedStatus = null;
                    if (f.note && typeof f.note === 'string' && f.note.startsWith("Status updated to Rehireable")) {
                        mappedStatus = "Rehireable";
                    } else if (f.note && typeof f.note === 'string' && f.note.startsWith("Status updated to Do Not Rehire")) {
                        mappedStatus = "Do Not Rehire";
                    }
                    
                    if (mappedStatus && f.date) { // Ensure it has a status AND a date
                        return { date: new Date(f.date), status: mappedStatus };
                    }
                    return null;
                })
                .filter(Boolean); // Filter out nulls

            if (statusFeedbacks.length > 0) {
                // 2. Sort by date descending to find the newest one
                statusFeedbacks.sort((a, b) => b.date - a.date);
                const latestStatus = statusFeedbacks[0].status;

                // 3. Set the status based *only* on this note.
                // An explicit admin status update always overrides the base "Terminated" status.
                finalStatus = latestStatus;
            }
        }
        // 4. Store the computed status
        driver.computedStatus = finalStatus;
    });

    // 3. Sort Data
    const sortedData = [...allArchivedData].sort((a, b) => {
        let valA, valB;
        switch (archiveSortColumn) {
            case 'name':
                valA = a.name || '';
                valB = b.name || '';
                return valA.localeCompare(valB);
            case 'mileage':
                valA = a.profile.medianMiles || 0;
                valB = b.profile.medianMiles || 0;
                return valA - valB;
            case 'score':
                valA = a.score || 0;
                valB = b.score || 0;
                return valA - valB;
                case 'status':
                    valA = a.computedStatus || 'Terminated';
                    valB = b.computedStatus || 'Terminated';
                    return valA.localeCompare(valB);
            default:
                return 0;
        }
    });

    if (archiveSortDirection === 'desc') {
        sortedData.reverse();
    }

    // 4. Filter Data (Change 'allArchivedData' to 'sortedData')
    const filteredDrivers = sortedData.filter(driver => {
        if (!driver.name.toLowerCase().includes(searchTerm)) {
            return false;
        }

        if (filterRules.length > 0) {
            const passesAdvancedFilters = (filterLogic === 'AND')
                ? filterRules.every(rule => evaluateRule(driver, rule))
                : filterRules.some(rule => evaluateRule(driver, rule));
            if (!passesAdvancedFilters) return false;
        }

        return true; 
    });

    // 5. Render Table
    if (filteredDrivers.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-slate-500">No drivers found.</td></tr>`;
        return;
    }

    // --- START: Row Rendering Fix ---
    // This block is now corrected to use driver.score and the text-only status
    tableBody.innerHTML = filteredDrivers.map(driver => {
        
        // FIX 1: Use driver.score (Feedback Score) for the 'Score' column
        const scoreDisplay = driver.score ? `${driver.score.toFixed(1)}/10` : '--';
        const scoreColor = driver.score ? (driver.score >= 7 ? 'text-green-400' : (driver.score >= 4 ? 'text-orange-400' : 'text-red-400')) : 'text-slate-500';

        // Get Mileage
        const mileageDisplay = driver.profile.medianMiles ? `${Math.round(driver.profile.medianMiles)} mi` : '--';
        
        // --- NEW STATUS LOGIC ---
        // Use the pre-computed status
        const status = driver.computedStatus;
        
        let statusColor = 'text-slate-400';
        if (status === 'Do Not Rehire') statusColor = 'text-red-500 font-bold';
        if (status === 'Rehireable') statusColor = 'text-green-500 font-bold';
        // --- END NEW STATUS LOGIC ---

        // Get Note Icon
        let noteIconHtml = '';
        const notes = (driver.feedback || []).filter(f => f.note && f.date);
        if (notes.length > 0) {
            notes.sort((a, b) => new Date(b.date) - new Date(a.date));
            const mostRecentNote = notes[0];
            const noteDate = new Date(mostRecentNote.date);
            const daysAgo = (new Date() - noteDate) / (1000 * 60 * 60 * 24);
            let noteColor = 'note-red';
            let tooltipText = `Last note: ${noteDate.toLocaleDateString()}`;
            if (daysAgo < 1) {
                noteColor = 'note-green';
                tooltipText = `Note added today`;
            } else if (daysAgo < 7) {
                noteColor = 'note-orange';
                tooltipText = `Last note: ${Math.floor(daysAgo)}d ago`;
            }
            noteIconHtml = `
                <div class="tooltip-container" data-tooltip="${tooltipText}">
                    <svg class="note-indicator-icon ${noteColor}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Zm2 4a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1Zm1 4a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7Z" clip-rule="evenodd" />
                    </svg>
                </div>`;
        }
        
        return `
        <tr class="cursor-pointer hover:bg-slate-800 ${driver.id == selectedArchivedDriverId ? 'active-archive-row' : ''}" data-driver-id="${driver.id}">
            <td class="px-3 py-2 text-slate-100 font-medium">
                <div class="flex items-center">
                    <span>${driver.name}</span>
                    ${noteIconHtml}
                </div>
            </td>
            <td class="px-3 py-2 text-center">${mileageDisplay}</td>
            <td class="px-3 py-2 text-center font-medium ${scoreColor}">${scoreDisplay}</td>
            <td class="px-3 py-2 text-center text-xs ${statusColor}">${status}</td>
        </tr>
        `;
    }).join('');
    // --- END: Row Rendering Fix ---
}

async function selectArchivedDriver(driverId) {
    if (selectedArchivedDriverId == driverId) return; 

    selectedArchivedDriverId = driverId;
    renderArchiveTable(); 

    const driverData = allArchivedData.find(d => d.id === driverId);

    if (driverData) {
        currentDriverFeedback = driverData.feedback || [];
        renderDriverProfile(driverData);
        document.getElementById('archive-default-message').classList.add('hidden');
        document.getElementById('archive-driver-profile').classList.remove('hidden');

        // Re-initialize tooltips for the newly rendered profile
        const profileArea = document.getElementById('archive-driver-profile');
        if (profileArea) {
            tooltipHandler(event, profileArea); // Re-run tooltip initializer
        }

    } else {
        document.getElementById('archive-default-message').classList.remove('hidden');
        document.getElementById('archive-driver-profile').classList.add('hidden');
        ui.showCustomAlert("Failed to find driver details.", "Error");
    }
}

/**
 * Formats balance/PO strings to include dollar signs.
 * e.g., "-60.99 (60.99)" becomes "$-61 ($61)"
 * @param {string} valueString
 */
function formatBalancePO(valueString) {
    if (!valueString || typeof valueString !== 'string') return '-';
    // Regex to find numbers (can be negative, can have decimals)
    const numbers = valueString.match(/-?[\d\.]+/g);
    if (!numbers || numbers.length === 0) return valueString; // Not the expected format

    if (numbers.length === 1) {
        return `$${parseFloat(numbers[0]).toFixed(0)}`;
    }
    if (numbers.length >= 2) {
        // This handles the "value (settle)" format
        const mainValue = parseFloat(numbers[0]).toFixed(0);
        const settleValue = parseFloat(numbers[1]).toFixed(0);
        return `$${mainValue} ($${settleValue})`;
    }
    return valueString; // Fallback
}

/**
 * Renders the entire right-hand profile pane with a driver's data.
 * @param {object} data - The full driver details object from the pre-loaded list.
 */
function renderDriverProfile(data) {
    const { profile, feedback, ...chartsData } = data;

    // 1. Populate Header
    document.getElementById('archive-driver-name').textContent = profile.name;
    const statusDateEl = document.getElementById('archive-status-date');

    // --- NEW STATUS LOGIC ---
    // Use the pre-computed status. We just need to find the latest date string for display.
    const baseStatus = data.computedStatus; // Use the pre-computed status
    let finalStatusString = baseStatus; // Default to just the status name
    let latestStatusDate = null;

    // 1. Get the date of the base "Terminated" status
    const statusStringMatch = (profile.status || '').match(/\(([^)]+)\)/);
    if (statusStringMatch) {
        latestStatusDate = new Date(statusStringMatch[1]);
    }

    // 2. Find the date of the *latest* status update note
    if (feedback && feedback.length > 0) {
        const statusFeedbacks = feedback
            .map(f => {
                let hasStatus = (f.note && typeof f.note === 'string' && (f.note.startsWith("Status updated to Rehireable") || f.note.startsWith("Status updated to Do Not Rehire")));
                if (hasStatus && f.date) {
                    return { date: new Date(f.date) };
                }
                return null;
            })
            .filter(Boolean);

        if (statusFeedbacks.length > 0) {
            statusFeedbacks.sort((a, b) => b.date - a.date);
            const latestFeedbackDate = statusFeedbacks[0].date;
            
            // 3. Compare and set the latest date
            if (!latestStatusDate || latestFeedbackDate > latestStatusDate) {
                latestStatusDate = latestFeedbackDate;
            }
        }
    }
    
    // 4. Append the latest date string, if we have one
    if (latestStatusDate) {
        finalStatusString = `${baseStatus} (${latestStatusDate.toISOString().split('T')[0]})`;
    }
    
    statusDateEl.textContent = finalStatusString;
    statusDateEl.classList.remove('hidden');
    // --- END NEW STATUS LOGIC ---

    // --- NEW: Logic to show/hide Edit button ---
    const statusButtons = document.getElementById('archive-status-buttons');
    const editButton = document.getElementById('archive-status-edit');
    
    // --- ONBOARDER CHECK REMOVED ---
    if (baseStatus === 'Rehireable' || baseStatus === 'Do Not Rehire') {
        // A status is set, so show "Edit"
        statusButtons.classList.add('hidden');
        editButton.classList.remove('hidden');
    } else {
        // No status (just "Terminated"), so show "✓" and "X"
        statusButtons.classList.remove('hidden');
        editButton.classList.add('hidden');
    }
    // --- END NEW ---

    // 2. Populate Key Metrics
    document.getElementById('archive-tenure').textContent = `${profile.tenure} wks`;
    document.getElementById('archive-mpg').textContent = profile.mpg ? `${parseFloat(profile.mpg).toFixed(2)} MPG` : '--';
    document.getElementById('archive-workload').textContent = profile.workload ? `${(profile.workload * 100).toFixed(0)}% Active` : '--';
    document.getElementById('archive-median-gross').textContent = `$${Math.round(profile.medianGross)}`;
    document.getElementById('archive-median-miles').textContent = `${Math.round(profile.medianMiles)} mi`;
    
    document.getElementById('archive-balance').textContent = formatBalancePO(profile.lastBalance);
    document.getElementById('archive-po').textContent = formatBalancePO(profile.lastPO);
    // FIX: Label change
    document.getElementById('archive-escrow').textContent = `$${parseFloat(profile.lastEscrow).toFixed(0)}`;

    // 3. Populate Affiliations
    const affiliationContainer = document.getElementById('archive-affiliation');
    affiliationContainer.innerHTML = `
        <div class="text-sm"><span class="text-slate-400">Dispatchers:</span><span class="font-medium text-white ml-2">${profile.affiliations.dispatchers.join(', ')}</span></div>
        <div class="text-sm"><span class="text-slate-400">Teams:</span><span class="font-medium text-white ml-2">${profile.affiliations.teams.join(', ')}</span></div>
        <div class="text-sm"><span class="text-slate-400">Franchises:</span><span class="font-medium text-white ml-2">${profile.affiliations.franchises.join(', ')}</span></div>
    `;

    // 4. Render Charts
    renderArchiveCharts(chartsData);

    // 5. Render Feedback
    renderFeedbackList(currentDriverFeedback);

    // 6. Calculate and render Avg Score
    let avgScore = 0;
    let scorePercent = 0;
    let scoreText = "--%"; // Default "loading" text
    const avgScoreBlock = document.getElementById('archive-avg-score');
    const avgScoreTextEl = document.getElementById('archive-avg-score-text'); 

    if (currentDriverFeedback.length > 0) {
        const scores = currentDriverFeedback.map(item => item.score).filter(s => s !== null && s !== undefined && s !== "");
        if (scores.length > 0) {
            const totalScore = scores.reduce((sum, score) => sum + parseFloat(score), 0);
            avgScore = (totalScore / scores.length) / 10; // Get a value between 0 and 1
            scorePercent = (avgScore * 100);
            scoreText = `${scorePercent.toFixed(0)}%`; // Format as percentage
        }
    }

    if (avgScoreTextEl) {
        avgScoreTextEl.textContent = scoreText;
    }

    const textClasses = ['text-slate-500', 'text-green-400', 'text-red-400'];
    const bgClasses = ['bg-slate-700', 'bg-green-800/20', 'bg-red-800/20'];
    const borderClasses = ['border-slate-600', 'border-green-600', 'border-red-600'];

    avgScoreBlock.classList.remove(...bgClasses, ...borderClasses);
    avgScoreTextEl.classList.remove(...textClasses);

    if (currentDriverFeedback.length > 0 && scoreText !== '--%') {
        if (avgScore >= 0.7) {
            avgScoreBlock.classList.add('bg-green-800/20', 'border-green-600');
            avgScoreTextEl.classList.add('text-green-400');
        } else {
            avgScoreBlock.classList.add('bg-red-800/20', 'border-red-600');
            avgScoreTextEl.classList.add('text-red-400');
        }
    } else {
        avgScoreBlock.classList.add('bg-slate-700', 'border-slate-600');
        avgScoreTextEl.classList.add('text-slate-500');
    }
}

// ADDED: New function to render feedback
function renderFeedbackList(feedback) {
    const feedbackContainer = document.getElementById('archive-feedback-container');
    const noteContainer = document.getElementById('archive-note-container');

    if (!feedback || feedback.length === 0) {
        feedbackContainer.innerHTML = `<p class="text-xs text-slate-500 text-center py-2">No feedback submitted yet.</p>`;
        noteContainer.innerHTML = `<p class="text-xs text-slate-500 text-center py-2">No notes added yet.</p>`;
        return;
    }

    const sortedFeedback = [...feedback].sort((a, b) => new Date(a.date) - new Date(b.date));

    let feedbackHtml = '';
    let noteHtml = '';

    sortedFeedback.forEach(item => {
        const itemDate = item.date ? new Date(item.date).toLocaleDateString() : 'No Date';

        // Check if this is a full feedback item (has a score)
        if (item.score !== undefined && item.score !== null && item.score !== "") {
          
            let rehireColor = 'text-white'; // Maybe
            if (item.rehire === 'Yes') rehireColor = 'text-green-400';
            if (item.rehire === 'No') rehireColor = 'text-red-400';

            let termsColor = 'text-green-400'; // Yes
            if (item.terms === 'No') termsColor = 'text-red-400';

            // --- MODIFIED HTML STRUCTURE ---
            feedbackHtml += `
            <div class="feedback-item-v4">
                <div class="fb-v4-header">
                    <span class="fb-v4-who" title="${item.from} (${item.role})">${item.from} (${item.role}) - ${itemDate}</span>
                    <span class="fb-v4-overall">Overall: ${item.score}/10</span>
                </div>

                <div class="fb-v4-stats-row">
                    <div class="fb-v4-stat-block">
                        <span class="fb-v4-label">Coachable</span>
                        <span class="fb-v4-value">${item.coachable}/10</span>
                    </div>
                    <div class="fb-v4-stat-block">
                        <span class="fb-v4-label">Hustle</span>
                        <span class="fb-v4-value">${item.hustle}/10</span>
                    </div>
                    <div class="fb-v4-stat-block">
                        <span class="fb-v4-label">Comm.</span>
                        <span class="fb-v4-value">${item.communication}/10</span>
                    </div>
                    <div class="fb-v4-stat-block">
                        <span class="fb-v4-label">Good Terms?</span>
                        <span class="fb-v4-value ${termsColor}">${item.terms}</span>
                    </div>
                    <div class="fb-v4-stat-block">
                        <span class="fb-v4-label">Rehire?</span>
                        <span class="fb-v4-value ${rehireColor}">${item.rehire}</span>
                    </div>
                </div>

                ${item.note ? `<div class="fb-v4-note">${item.note}</div>` : ''}
            </div>
            `;
            // --- END MODIFICATION ---
        } 
        // Check if this is a "note-only" item
        else if (item.note && item.note.startsWith("Status updated to")) {
            // Render as a system message, not a chat bubble

            // Extract the status, e.g., "Rehireable." or "Do Not Rehire."
            const statusText = item.note.replace("Status updated to ", "").replace(".", "");

            noteHtml += `
            <div class="text-center my-2">
                <span class="text-xs text-slate-500 italic px-2 py-0.5 bg-slate-800 rounded-full">
                    Status: ${statusText}, ${itemDate}
                </span>
            </div>
            `;
        }

        // Check if this is a "note-only" item
        else if (item.note) {
            // --- Render as a Chat Bubble ---
            const isMe = (item.from === currentUser.email);

            // --- FIX: Robust author name handling ---
            let authorName = 'User';
            if (isMe) {
                authorName = 'Me';
            } else if (item.from && item.from.includes('@')) {
                authorName = item.from.split('@')[0]; // Show email prefix
            } else if (item.from) {
                authorName = item.from; // Show 'Feedback Form' or 'Admin'
            } else if (item.role) {
                authorName = item.role; // Fallback to role
            }
            // --- END FIX ---

            noteHtml += `
            <div class="chat-bubble ${isMe ? 'my-message' : 'other-message'}">
                <span class="author">${authorName} - ${itemDate}</span>
                <span class="note-body">${item.note}</span>
            </div>
            `;
        }
    });

    feedbackContainer.innerHTML = feedbackHtml || `<p class="text-xs text-slate-500 text-center py-2">No feedback submitted yet.</p>`;
    noteContainer.innerHTML = noteHtml || `<p class="text-xs text-slate-500 text-center py-2">No notes added yet.</p>`;

    // --- ADD THIS: Auto-scroll the chat box to the bottom ---
    if (noteContainer.innerHTML) {
        noteContainer.scrollTop = noteContainer.scrollHeight;
    }
}

/**
 * Handles switching tabs in the archive profile view.
 * @param {string} tabName - 'financials', 'balances', or 'safety'
 */
function switchArchiveTab(tabName) {
    document.querySelectorAll('.archive-tab').forEach(tab => {
        const isTargetTab = tab.dataset.tab === tabName;
        tab.classList.toggle('active-tab', isTargetTab);
        tab.classList.toggle('text-white', isTargetTab);
        tab.classList.toggle('border-blue-500', isTargetTab);
        tab.classList.toggle('text-slate-400', !isTargetTab);
    });

    document.querySelectorAll('.archive-tab-content').forEach(content => {
        content.classList.toggle('hidden', content.id !== `${tabName}-content`);
    });
}

/**
 * Creates or updates all charts in the archive view.
 * @param {object} chartsData - Contains financials, balances, and safety data.
 */
function renderArchiveCharts(chartsData) {
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
            x: { type: 'time', time: { unit: 'day' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } },
            y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }
        },
        plugins: { 
            legend: { position: 'bottom', labels: { color: '#e2e8f0', usePointStyle: false, boxWidth: 25, boxHeight: 2, padding: 10 } }
        }
    };

    // 1. Financials Chart
    if (archiveCharts.financials) archiveCharts.financials.destroy();
    archiveCharts.financials = new Chart(document.getElementById('archive-financials-chart'), {
        type: 'line',
        data: {
            datasets: [
                { label: 'Mileage', data: chartsData.financials.mileage, borderColor: '#3b82f6', tension: 0.1, yAxisID: 'y' },
                { label: 'Gross', data: chartsData.financials.gross, borderColor: '#10b981', tension: 0.1, yAxisID: 'y1' },
                { label: 'Net', data: chartsData.financials.net, borderColor: '#f59e0b', tension: 0.1, yAxisID: 'y1' }
            ]
        },
        options: { 
            ...chartOptions, 
            scales: {
                x: { type: 'time', time: { unit: 'day' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                y: { type: 'linear', position: 'left', title: { display: true, text: 'Miles', color: '#3b82f6' }, ticks: { color: '#94a3b8' }, grid: { drawOnChartArea: false } },
                y1: { type: 'linear', position: 'right', title: { display: true, text: 'USD ($)', color: '#e2e8f0' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }
            },
            // --- FIX FOR CHART TOOLTIP (DATE & NET) ---
            plugins: { 
                legend: { position: 'bottom', labels: { color: '#e2e8f0', usePointStyle: false, boxWidth: 25, boxHeight: 2, padding: 10 } },
                tooltip: {
                    callbacks: {
                        // <-- NEW CALLBACK
                        title: function(tooltipItems) {
                            // This formats the date without the time
                            const date = new Date(tooltipItems[0].parsed.x);
                            return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                // This rounds all values to whole numbers
                                label += Math.round(context.parsed.y).toLocaleString();
                                // Add " mi" for mileage
                                if (context.dataset.label === 'Mileage') {
                                    label += ' mi';
                                } else {
                                    // Add "$" for Gross and Net
                                    label = label.replace(context.dataset.label + ':', context.dataset.label + ': $');
                                }
                            }
                            return label;
                        }
                        // <-- END NEW CALLBACK
                    }
                }
            }
            // --- END FIX ---
        }
    });

    // 2. Balances Chart
    if (archiveCharts.balances) archiveCharts.balances.destroy();
    archiveCharts.balances = new Chart(document.getElementById('archive-balances-chart'), {
        type: 'line',
        data: {
            datasets: [
                { label: 'Balance', data: chartsData.balances.balance, borderColor: '#ef4444', tension: 0.1 },
                { label: 'PO', data: chartsData.balances.po, borderColor: '#f59e0b', tension: 0.1 },
                { label: 'Escrow', data: chartsData.balances.escrow, borderColor: '#10b981', tension: 0.1 }
            ]
        },
        options: {
            ...chartOptions,
            // --- FIX FOR BALANCES CHART TOOLTIP (ROUNDING) ---
            plugins: { 
                legend: { position: 'bottom', labels: { color: '#e2e8f0', usePointStyle: false, boxWidth: 25, boxHeight: 2, padding: 10 } },
                tooltip: {
                    callbacks: {
                        // <-- NEW CALLBACK
                        title: function(tooltipItems) {
                            const date = new Date(tooltipItems[0].parsed.x);
                            return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                // This rounds all values and adds a $ sign
                                label += `$${Math.round(context.parsed.y).toLocaleString()}`;
                            }
                            return label;
                        }
                        // <-- END NEW CALLBACK
                    }
                }
            }
            // --- END FIX ---
        }
    });

    // 3. Safety Chart
    if (archiveCharts.safety) archiveCharts.safety.destroy();
    archiveCharts.safety = new Chart(document.getElementById('archive-safety-chart'), {
        type: 'line',
        data: {
            datasets: [
                { label: 'Safety Score', data: chartsData.safety.score, borderColor: '#3b82f6', tension: 0.1, yAxisID: 'y1' },
                { label: 'Speeding', data: chartsData.safety.speeding, borderColor: '#f59e0b', tension: 0.1, yAxisID: 'y' },
                { label: 'Harsh Events', data: chartsData.safety.harsh, borderColor: '#ef4444', tension: 0.1, yAxisID: 'y' }
            ]
        },
        options: { 
            ...chartOptions, 
            scales: {
                x: { type: 'time', time: { unit: 'day' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                y: { type: 'linear', position: 'left', title: { display: true, text: 'Events', color: '#e2e8f0' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, beginAtZero: true },
                y1: { type: 'linear', position: 'right', title: { display: true, text: 'Score %', color: '#3b82f6' }, ticks: { color: '#94a3b8' }, grid: { drawOnChartArea: false }, min: 0, max: 100 }
            },
            // --- FIX FOR SAFETY CHART TOOLTIP (DATE) ---
            plugins: { 
                legend: { position: 'bottom', labels: { color: '#e2e8f0', usePointStyle: false, boxWidth: 25, boxHeight: 2, padding: 10 } },
                tooltip: {
                    callbacks: {
                        // <-- NEW CALLBACK
                        title: function(tooltipItems) {
                            const date = new Date(tooltipItems[0].parsed.x);
                            return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
                        }
                        // <-- END NEW CALLBACK
                    }
                }
            }
            // --- END FIX ---
        }
    });

    // Switch to the first tab by default
    switchArchiveTab('financials');
}

/**
 * Opens the feedback request modal and populates its fields.
 */
function openFeedbackRequestModal() {
    if (!selectedArchivedDriverId) return;
    const driver = allArchivedData.find(d => d.id == selectedArchivedDriverId);
    if (!driver) return;

    document.getElementById('feedback-modal-driver-name').textContent = driver.name;
    document.getElementById('feedback-role-select').value = 'dispatcher';

    document.getElementById('feedback-request-modal').classList.remove('hidden');
}



/**
 * Closes the feedback request modal.
 */
function closeFeedbackRequestModal() {
    document.getElementById('feedback-request-modal').classList.add('hidden');
}

// --- ADDED: New function to close the link modal ---
/**
 * Closes the feedback link display modal.
 */
function closeFeedbackLinkModal() {
    document.getElementById('feedback-link-modal').classList.add('hidden');
}

function generateFeedbackLink() {
    const role = document.getElementById('feedback-role-select').value;

    // Find the driver's name from the list
    const driver = allArchivedData.find(d => d.id == selectedArchivedDriverId); 
    if (!driver) {
        ui.showCustomAlert("Error: Could not find driver name.", "Error");
        return;
    }

    const driverName = encodeURIComponent(driver.name); // Make the name URL-safe
    const token = Math.random().toString(36).substring(2, 10);
    
    // Construct the link with all required parameters
    const generatedLink = `${window.location.origin}/feedback.html?driverId=${selectedArchivedDriverId}&driverName=${driverName}&role=${role}&token=${token}`;

    // Set the link in the new modal's input field
    document.getElementById('feedback-generated-link').value = generatedLink;

    // Close the first modal and open the new one
    closeFeedbackRequestModal();
    document.getElementById('feedback-link-modal').classList.remove('hidden');
}

// ADDED: New functions for the "Add Note" modal
/**
 * Sends a new chat note to Supabase.
 * This REPLACES the old modal-based submitNote function.
 */
async function sendChatNote(noteText) {
    const btn = document.getElementById('archive-send-note-btn');
    if (btn) btn.disabled = true; // Disable send button

    // 1. Create the note object for our 'notes' table
    const noteData = {
        driver_id: selectedArchivedDriverId,
        note: noteText,
        author_email: currentUser.email,
        author_role: currentUser.role
    };

    try {
        // 2. Send it to Supabase
        const { error } = await supabase.from('notes').insert(noteData);
        if (error) throw new Error(error.message);

        // 3. SUCCESS!
        // The realtime listener (`listenForLiveUpdates`) will
        // receive this message and render it in the chat.
        // We don't need to do anything else here.

    } catch (error) {
        // 4. Show any errors (e.g., if database is down)
        console.error("Failed to send note:", error);
        // We can optionally show an alert
        // ui.showCustomAlert(`Failed to send note: ${error.message}`, 'Error');
    }

    // 5. Re-enable the button
    if (btn) btn.disabled = false;
}

/**
 * Renders the Fuel Tank Analysis table.
 * @param {Array<Object>} reportData - The analysis results from runTruckFuelAnalysis.
 */
function renderFuelTankTable(reportData) {
    const tableBody = document.getElementById('fuel-tank-table-body');
    
    if (reportData.length === 0) {
        // --- UPDATE COLSPAN ---
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-slate-500">No matched fueling events found for any truck.</td></tr>`;
        return;
    }
    
    tableBody.innerHTML = reportData.map(truck => {
        const diff = truck.discrepancyGallons;
        const diffPct = truck.discrepancyPercent;
        
        let diffColor = 'text-slate-300';
        if (diffPct > 10) diffColor = 'text-green-400';
        if (diffPct < -10) diffColor = 'text-red-400';

        return `
            <tr class="hover:bg-slate-800">
                <td class="px-4 py-2 font-medium text-slate-100">${truck.truckId}</td>
                <td class="px-4 py-2 text-slate-300 text-xs" style="min-width: 200px;">${truck.drivers.join(', ')}</td>
                <td class="px-4 py-2 text-center">${truck.eventCount}</td>
                <td class="px-4 py-2 text-center">${truck.medianSystemSize.toFixed(0)} GAL</td>
                <td class="px-4 py-2 text-center">${truck.medianPurchaseSize.toFixed(0)} GAL</td>
                <td class="px-4 py-2 text-center font-semibold ${diffColor}">${diff.toFixed(0)} GAL</td>
                <td class="px-4 py-2 text-center font-semibold ${diffColor}">${diffPct.toFixed(1)}%</td>
            </tr>
        `;
    }).join('');
}

/**
 * Loads cached data, runs the analysis, and renders the new page.
 */
function loadAndRenderFuelTankAnalysis() {
    const tableBody = document.getElementById('fuel-tank-table-body');
    // --- UPDATE COLSPAN ---
    tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-slate-500">Running analysis on all truck data...</td></tr>`;

    // Get the complete cached data
    const allHourlyData = getCachedFuelHistory();
    const allPurchaseData = getCachedPurchaseHistory();

    // Check if the background fetch is complete
    if (!allHourlyData || !allPurchaseData) {
        // --- UPDATE COLSPAN ---
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-orange-400">Data is still loading in the background. Please wait a moment and try again.</td></tr>`;
        return;
    }

    try {
        // Run the heavy analysis
        const analysisResults = runTruckFuelAnalysis(allHourlyData, allPurchaseData);
        // Render the final table
        renderFuelTankTable(analysisResults);
    } catch (error) {
        console.error("Failed to run fuel tank analysis:", error);
        // --- UPDATE COLSPAN ---
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-red-500">An error occurred during analysis: ${error.message}</td></tr>`;
    }
}
