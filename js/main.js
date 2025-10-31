/**
 * main.js
 * * The entry point and controller for the application.
 * It initializes the app, manages state, and wires up all event listeners.
 */
import * as config from './config.js';
import * as api from './api.js';
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
let allSafetyData = {};
let financialData = [];
let driversForDate = [];
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
let savedOverrides = [];
let allWeeklyNotes = {};
let allLockedData = {};

// --- DOM ELEMENT REFERENCES ---
const searchInput = document.getElementById('search-input');
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
            else if (userRole === 'Driver Rep' && userAccessList.includes(d.driver_rep)) hasAccess = true;
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

    if (currentUser && currentUser.role.trim() === 'Driver Rep') {
        filteredDrivers = filteredDrivers.filter(driver => driver.isLocked === true);
    }

    filteredDrivers.sort((a, b) => {
        if (a.contract_type === 'TPOG' && b.contract_type !== 'TPOG') return -1;
        if (a.contract_type !== 'TPOG' && b.contract_type === 'TPOG') return 1;
        return 0;
    });

    ui.renderTable(filteredDrivers, {
        orderedColumnKeys,
        visibleColumnKeys,
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

function initializeEventListeners() {
    const globalTooltip = document.getElementById('global-tooltip');
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
        if (target.matches('.filter-column') || target.matches('.filter-operator')) {
            ui.updateFilterValueField(target.closest('.filter-row'), allDrivers);
        }
        filterAndRenderTable();
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
            ui.renderSettingsContent(tempSettings);
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

            // --- FIX STARTS HERE ---

            // 1. Get the original CALCULATED report data for accurate comparison.
            const originalReportData = calc.getDriverReportData(driverForDate, settings);
    
            const fieldsToUpdate = {};
            document.querySelectorAll('#edit-content .edit-input').forEach(input => {
                const key = input.id.replace('edit-', '');
                const newValue = input.value;
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
            
            // --- FIX ENDS HERE ---
    
            if (Object.keys(fieldsToUpdate).length > 0) {
                ui.showLoadingOverlay();
                const payDate = driverForDate.pay_date.split('T')[0];
                const updates = Object.entries(fieldsToUpdate).map(([fieldName, newValue]) => {
                    return { fieldName, newValue };
                });
                await api.saveEditableData(driverForDate.id, payDate, updates);

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

                processDataForSelectedDate();
                filterAndRenderTable();
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
                await api.revertToDefault(driverForDate.id, payDate);
                window.location.reload(); // Reload to clear all data and fetch fresh
            }
        }
    });

    // Add a global click listener to close the dropdown if clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('split-button-dropdown');
        const container = e.target.closest('.split-button-container');
        if (dropdown && !dropdown.classList.contains('hidden') && !container) {
            dropdown.classList.add('hidden');
        }
    });

    tableBody.addEventListener('click', async e => {
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
                ui.openActivityHistoryModal(driver, mileageData, settings, daysTakenHistory, dispatcherOverrides);
            }
            return;
        }

        if (e.target.closest('.lock-btn')) {
            e.stopPropagation();
            // Find the *fully processed* driver object
            const driver = processedDriversForDate.find(d => d.id == targetElement.dataset.driverId);
            if(driver) {
                const confirmed = await showCustomConfirm(
                    'Lock Week',
                    `Are you sure you want to lock and snapshot this week for ${driver.name}?\n\nThis will save all current data and prevent future backend changes from affecting this record.`,
                    { confirmText: 'Lock & Snapshot' }
                );
                if (confirmed) {
                    ui.showLoadingOverlay();
                    const payDate = driver.pay_date.split('T')[0];

            // 1. Get the final calculated report
            const finalReportData = calc.getDriverReportData(driver, settings, driversForDate);
            
            // 2. Merge the report data AND the *entire* settings object
            const driverWithCalculations = {
                ...driver,
                ...finalReportData,
                // --- MODIFIED LINE ---
                // Save the *entire* settings object at the moment of locking
                lockedSettings: settings 
                // --- END MODIFICATION ---
            };
            
            // 3. Stringify the *complete* object
            const driverSnapshotJSON = JSON.stringify(driverWithCalculations);
                    
                    // Send the entire snapshot to the backend
                    api.updateLockedData(driver.id, driver.name, payDate, 'lock', driverSnapshotJSON)
                        .then((result) => {
                            // --- SUCCESS ---
                            // This code only runs if the API call was successful
                            
                            // Update local cache
                            allLockedData[`${driver.id}_${payDate}`] = driverSnapshotJSON;
                            // Re-process to apply the lock status
                            processDataForSelectedDate(); 
                            filterAndRenderTable();
                            ui.hideLoadingOverlay();
                            ui.showToast('Week locked & snapshot saved!', 'success');
                        })
                        .catch((error) => {
                            // --- FAILURE ---
                            // This code runs if the API call failed (e.g., "Failed to fetch")
                            
                            // Do not update local cache. Do not re-render.
                            console.error("Failed to lock week:", error);
                            ui.hideLoadingOverlay();
                            // Show a user-friendly error instead of the old alert()
                            ui.showCustomAlert(`Failed to lock week: ${error.message}. The save was aborted. Please check your connection and try again.`, 'Save Failed');
                        });
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
                        // Delete local snapshot
                        delete allLockedData[`${driver.id}_${payDate}`];
                        // Re-process *all data* to get the live data back
                        processDataForSelectedDate(); 
                        filterAndRenderTable();
                        ui.hideLoadingOverlay();
                        ui.showToast('Week unlocked! Live data is now active.', 'success');
                    });
                }
            }
            return;
        }
        
        if (e.target.closest('td[data-key="milesWeek"]') || e.target.closest('td[data-key="samsaraDistance"]')) {
            // 1. Admin-only check
            if (!currentUser || currentUser.role.trim() !== 'Admin') {
                return; // Exit if the user is not an Admin
            }

            // Find the *processed* driver object to check its lock status
            const driver = processedDriversForDate.find(d => d.id == e.target.closest('tr').dataset.driverId);
            if (!driver) return;

            // 2. Check if the week is locked
            if (driver.isLocked) {
                return; // Exit if locked, do not allow switching
            }
            
            // 3. Show the loading screen immediately
            ui.showLoadingOverlay();

            // Use a timeout to let the browser render the overlay *before* the freeze
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
                
                // Re-process all data to apply the new override
                processDataForSelectedDate();
                
                // Re-render the table with the new calculations
                filterAndRenderTable();
                
                // 3. Hide the loading screen
                ui.hideLoadingOverlay();
            }, 50); // A 50ms delay is enough for the UI to update

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
    tooltipHandler(event, tableBody);
    tooltipHandler(event, activityHistoryContent);
    tooltipHandler(event, settingsContent);
    
    tableHead.addEventListener('click', e => {
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
                driversForDate.sort((a, b) => {
                    let valA = (key === 'totalTpog') ? calc.calculateDriverTPOG(a, settings) : a[key];
                    let valB = (key === 'totalTpog') ? calc.calculateDriverTPOG(b, settings) : b[key];
                    if (typeof valA === 'number') return isAsc ? valA - valB : valB - valA;
                    return isAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
                });
                ui.renderTable(driversForDate, { orderedColumnKeys, visibleColumnKeys, pinnedColumns, settings, overriddenDistances });
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
        
        if (selectedRole === 'Admin') {
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
}

async function logout() {
    const confirmed = await showCustomConfirm('Logout', 'Are you sure you want to log out?', { confirmText: 'Logout' });
    if (confirmed) {
        sessionStorage.removeItem('sessionToken');
        sessionStorage.removeItem('user');
        window.location.reload();
    }
}

function switchView(viewName) {
    // Hide all main view containers first
    document.querySelector('main > header').classList.add('hidden');
    document.getElementById('table-wrapper').closest('.bg-slate-900').classList.add('hidden');
    document.getElementById('profiles-view').classList.add('hidden');
    document.getElementById('dispatcher-view').classList.add('hidden');

    // Deactivate all sidebar links
    document.querySelectorAll('#sidebar nav a').forEach(a => a.classList.remove('active', 'bg-slate-700'));

    if (viewName === 'table') {
        document.querySelector('main > header').classList.remove('hidden');
        document.getElementById('table-wrapper').closest('.bg-slate-900').classList.remove('hidden');
        document.getElementById('nav-table').classList.add('active', 'bg-slate-700');
    } else if (viewName === 'profiles') {
        document.getElementById('profiles-view').classList.remove('hidden');
        document.getElementById('nav-profiles').classList.add('active', 'bg-slate-700');
        loadAndRenderUsers();
    } else if (viewName === 'dispatcher') {
        document.getElementById('dispatcher-view').classList.remove('hidden');
        document.getElementById('nav-dispatcher').classList.add('active', 'bg-slate-700');
        // Check if it's the first time loading this view to avoid re-initializing
        if (!document.body.classList.contains('dispatcher-initialized')) {
            // Pass all necessary data to the dispatcher view
            initDispatcherView(currentUser, allWeeklyNotes, allLockedData, allDrivers); 
            document.body.classList.add('dispatcher-initialized');
        }
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
        weeklyLocksData
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
        logPerformance('Locked Data', api.loadLockedData())
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
            currentUser = result.user;
            sessionToken = result.token;
            sessionStorage.setItem('sessionToken', sessionToken);
            sessionStorage.setItem('user', JSON.stringify(currentUser));
            
            const userRole = currentUser.role.trim();
            const allowedVerificationRoles = ['Admin', 'Dispatcher', 'Team'];

            if (!allowedVerificationRoles.includes(userRole)) {
                const navDispatcherLink = document.getElementById('nav-dispatcher');
                if (navDispatcherLink) {
                    navDispatcherLink.style.display = 'none';
                }
            }

            if (userRole !== 'Admin') {
                const navProfilesLink = document.getElementById('nav-profiles');
                if (navProfilesLink) navProfilesLink.style.display = 'none';
                const settingsBtn = document.getElementById('open-settings-btn');
                if (settingsBtn) settingsBtn.style.display = 'none';
                const manualReportBtn = document.getElementById('create-manual-report-btn');
                if (manualReportBtn) manualReportBtn.style.display = 'none';
                
                // --- NEW LOGIC ---
                // Only hide "Actions" if the user is NOT a Driver Rep.
                // This will keep the "Actions" column visible for Driver Reps.
                if (userRole !== 'Driver Rep') {
                    visibleColumnKeys = visibleColumnKeys.filter(key => key !== 'actions');
                }
                // --- END NEW LOGIC ---
            }

            const loginOverlay = document.getElementById('login-overlay');
            const loadingOverlay = document.getElementById('loading-overlay');
            if (loginOverlay) loginOverlay.style.display = 'none';
            if (loadingOverlay) loadingOverlay.classList.remove('hidden');

            await dataLoadingPromise;
            await showMainApp();
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
    // Get the raw driver data for the selected date from the main list.
    driversForDate = allDrivers.filter(d => d.pay_date && d.pay_date.split('T')[0] === selectedDate);
    // Run the expensive processing and cache the result in our new variable.
    processedDriversForDate = calc.processDriverDataForDate(driversForDate, mileageData, settings, allSafetyData, overriddenDistances, daysTakenHistory, dispatcherOverrides, allDrivers);

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
            const originalReviewed = driver.isDispatcherReviewed; // from calc

            // 3. Overwrite the live driver object with the snapshot
            Object.assign(driver, lockedData);

            // 4. Restore the preserved properties
            driver.id = originalId;
            driver.weeklyNote = originalNote;
            driver.isDispatcherReviewed = originalReviewed;
            
            // 5. Set the lock flag
            driver.isLocked = true;
        } else {
            // This week is not locked
            driver.isLocked = false;
        }
    });
    // --- END: APPLY SNAPSHOTS (LOCKS) ---
}

function initDispatcherView(currentUser, initialWeeklyNotes, initialLockedData, allDrivers) {
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
            drivers[driverName] = { name: driverName, dispatcher: row.dispatch, team: row.team, activity: {} };
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

        // Show and populate the note area
        const noteKey = `${selectedDriverName}_${selectedDateStr}`;
        noteInput.value = weeklyNotes[noteKey] || '';
        noteArea.classList.remove('hidden');
        saveNoteBtn.disabled = false;
        saveNoteBtn.textContent = 'Save Note';
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
            await fetch(config.DISPATCHER_OVERRIDES_URL, {
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
        noteArea.classList.add('hidden');
        renderDriverList();
        renderActivityView();
    }

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
            const [savedOverridesData, driverList, mileageData, samsaraData, changelogData] = await Promise.all([
                fetchData(config.DISPATCHER_OVERRIDES_URL, 'Dispatcher Overrides'),
                fetchData(config.DRIVER_DATA_URL, 'Driver List'),
                fetchData(config.MILEAGE_DATA_URL, 'Mileage Data'),
                fetchData(config.ALL_SAFETY_DATA_URL, 'Samsara Data'),
                fetchData(config.DAYS_TAKEN_HISTORY_URL, 'Activity Logs')
            ]);
            
            savedOverrides = savedOverridesData.reduce((acc, row) => {
                acc[`${row['Driver Name']}_${row['Date']}`] = row['Confirmed Status'];
                return acc;
            }, {});
            
            // Re-load notes from API in case they were changed elsewhere
            weeklyNotes = await api.loadWeeklyNotes(); 
            weeklyLocks = await api.loadLockedData();
            
            allDriverData = processAllData(driverList, mileageData, samsaraData, changelogData);
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
        init(true);
    });

    saveNoteBtn.addEventListener('click', async () => {
        const noteText = noteInput.value; // Get full text, even if empty
        const driverName = selectedDriverName;
        const payDate = payDateSelect.value;
        const noteKey = `${driverName}_${payDate}`;

        saveNoteBtn.disabled = true;
        saveNoteBtn.textContent = 'Saving...';

        const result = await api.saveWeeklyNote(driverName, payDate, noteText);

        if (result.status === 'success') {
            showToast('Note saved successfully!', 'success');
            // Update local cache
            if (noteText) {
                weeklyNotes[noteKey] = noteText;
            } else {
                delete weeklyNotes[noteKey]; // Remove if note was cleared
            }
            
            // Update global cache for the main table
            if (noteText) {
                allWeeklyNotes[noteKey] = noteText;
            } else {
                delete allWeeklyNotes[noteKey]; // Remove if note was cleared
            }

            // Re-process and render the main table to show/hide the icon
            processDataForSelectedDate();
            filterAndRenderTable();
        } else {
            showToast('Failed to save note.', 'error');
        }

        saveNoteBtn.disabled = false;
        saveNoteBtn.textContent = 'Save Note';
    });

    init(); // Initial Load
}

