/**
 * main.js
 * * The entry point and controller for the application.
 * It initializes the app, manages state, and wires up all event listeners.
 */

import { columnConfig } from './config.js';
import * as api from './api.js';
import * as calc from './calculations.js';
import * as ui from './ui.js';

// --- STATE MANAGEMENT ---
const CORRECT_PIN = '7777';
let settings = {};
let allDrivers = [];
let mileageData = [];
let allSafetyData = {};
let financialData = [];
let driversForDate = [];
let availableContractTypes = [];
let orderedColumnKeys = Object.keys(columnConfig);
const defaultHiddenColumns = ['dispatcher', 'team', 'rpm', 'speeding_over11mph', 'speeding_over16mph', 'franchise', 'company', 'gross', 'pay_delayWks', 'stubMiles'];
let visibleColumnKeys = Object.keys(columnConfig).filter(key => !defaultHiddenColumns.includes(key));
let pinnedColumns = { left: ['name'], right: ['totalTpog', 'bonuses', 'penalties', 'escrowDeduct', 'actions'] };
let activeRowFilter = 'none'; // Can be 'none', 'zero-rows', 'no-samsara', 'no-prologs', 'no-samsara-or-prologs', 'no-samsara-and-prologs'
let currentEditingDriverId = null;
let draggedColumnKey = null;
let overriddenDistances = {};
let daysTakenHistory = [];
let dispatcherOverrides = {};

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

// --- PERFORMANCE HELPER ---
/**
 * Debounce function to limit the rate at which a function is called.
 * @param {Function} func The function to debounce.
 * @param {number} delay The delay in milliseconds.
 * @returns {Function} The debounced function.
 */
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
    const selectedDate = payDateSelect.value;
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
            } else if (valueElement.value) { // It's an input
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

    driversForDate = allDrivers.filter(d => d.pay_date && d.pay_date.split('T')[0] === selectedDate);
    driversForDate = calc.processDriverDataForDate(driversForDate, mileageData, settings, allSafetyData, overriddenDistances, daysTakenHistory, dispatcherOverrides, allDrivers); 

    const evaluateRule = (driver, rule) => {
        const { column, operator, value } = rule;
        const driverValue = driver[column];
        const normalizedDriverValue = String(driverValue || '').toLowerCase();

        if ((operator !== 'is_empty' && operator !== 'is_not_empty') && value.length === 0) {
            return true; // Don't filter if value is empty for operators that need it
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

    let filteredDrivers = driversForDate.filter(d => {
        const matchesSearch = (d.name || '').toLowerCase().startsWith(searchTerm);
        if (!matchesSearch) return false;

        if (filterRules.length === 0) return true;

        if (filterLogic === 'AND') {
            return filterRules.every(rule => evaluateRule(d, rule));
        } else { // OR logic
            return filterRules.some(rule => evaluateRule(d, rule));
        }
    });

    if (activeRowFilter !== 'none') {
        filteredDrivers = filteredDrivers.filter(driver => {
            const hasSamsara = (driver.samsaraDistance || 0) > 0;
            const hasPrologs = (driver.milesWeek || 0) > 0;

            switch (activeRowFilter) {
                case 'zero-rows':
                    const safetyScore = parseFloat(driver.safetyScore) || 0;
                    const speedingAlerts = parseInt(driver.speedingAlerts, 10) || 0;
                    const weeksOut = parseInt(driver.weeksOut, 10) || 0;
                    const milesWeek = parseFloat(driver.milesWeek) || 0;
                    const mpg = parseFloat(driver.mpg) || 0;
                    const tenure = parseInt(driver.tenure, 10) || 0;
                    return safetyScore !== 0 || speedingAlerts !== 0 || weeksOut !== 0 || milesWeek !== 0 || mpg !== 0 || tenure !== 0;
                case 'no-samsara':
                    return hasSamsara;
                case 'no-prologs':
                    return hasPrologs;
                case 'no-samsara-or-prologs':
                    return hasSamsara || hasPrologs;
                case 'no-samsara-and-prologs':
                    return hasSamsara && hasPrologs;
                default:
                    return true;
            }
        });
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
    });
}

/**
 * Handles the logic for downloading a manually edited report.
 */
function downloadManualReport() {
    const isNew = currentEditingDriverId === null;
    const manualDriverData = { id: isNew ? Date.now() : currentEditingDriverId };
    manualDriverData.pay_date = payDateSelect.value + 'T00:00:00.000Z';
    manualDriverData.name = isNew ? document.getElementById('edit-name').value || "Manual Entry" : driversForDate.find(d => d.id == currentEditingDriverId).name;

    Object.keys(columnConfig)
        .filter(k => k !== 'id' && k !== 'name' && k !== 'totalTpog' && k !== 'actions')
        .forEach(key => {
            const input = document.getElementById(`edit-${key}`);
            if (input) {
                if (columnConfig[key].type === 'number' || columnConfig[key].type === 'percent' || key === 'availableOffDays' || key === 'escrowDeduct') {
                    const parsedValue = parseFloat(input.value);
                    // This is a more robust check to ensure we always get a number, defaulting to 0.
                    manualDriverData[key] = isNaN(parsedValue) ? 0 : parsedValue;
                } else {
                    manualDriverData[key] = input.value;
                }
            }
    });

    // Manually add the newly editable fields since they aren't in columnConfig
    const availableOffDaysInput = document.getElementById('edit-availableOffDays');
    if(availableOffDaysInput) manualDriverData.availableOffDays = parseFloat(availableOffDaysInput.value) || 0;

    const escrowDeductInput = document.getElementById('edit-escrowDeduct');
    if(escrowDeductInput) manualDriverData.escrowDeduct = parseFloat(escrowDeductInput.value) || 0;


    ui.downloadDriverReport(manualDriverData, settings, driversForDate);
    ui.closeEditPanel();
}


/**
 * Sets up all event listeners for the application.
 */
function initializeEventListeners() {
    // --- CORRECTED: Define element references at the top ---
    const globalTooltip = document.getElementById('global-tooltip');
    const activityHistoryContent = document.getElementById('activity-history-content');

    // Create a debounced version of the filter function
    const debouncedFilterAndRender = debounce(filterAndRenderTable, 300);

    searchInput.addEventListener('input', debouncedFilterAndRender);
    payDateSelect.addEventListener('change', filterAndRenderTable);
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

            // Remove active class from all options
            rowFilterOptions.querySelectorAll('a').forEach(opt => opt.classList.remove('active-filter'));
            // Add active class to the clicked option
            clickedOption.classList.add('active-filter');

            const eyeIcon = `<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
            const eyeOffIcon = `<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59"/>`;

            if (activeRowFilter === 'none') {
                rowFilterBtn.classList.remove('active');
                rowFilterIcon.innerHTML = eyeOffIcon;
            } else {
                rowFilterBtn.classList.add('active');
                rowFilterIcon.innerHTML = eyeIcon;
            }

            filterAndRenderTable();
            rowFilterOptions.classList.add('hidden');
        }
    });
    
    columnToggleBtn.addEventListener('click', () => columnToggleOptions.classList.toggle('hidden'));
    generalFilterBtn.addEventListener('click', () => generalFilterPanel.classList.toggle('hidden'));
    addFilterBtn.addEventListener('click', () => ui.addFilterRow(filterRowsContainer, allDrivers, filterAndRenderTable));
    removeAllFiltersBtn.addEventListener('click', () => {
        filterRowsContainer.innerHTML = '';
        filterAndRenderTable();
    });

    filterRowsContainer.addEventListener('change', e => {
        const target = e.target;
        if (target.matches('.filter-column') || target.matches('.filter-operator')) {
            const filterRow = target.closest('.filter-row');
            ui.updateFilterValueField(filterRow, allDrivers);
        }
        filterAndRenderTable();
    });

    filterRowsContainer.addEventListener('click', e => {
        if (e.target.closest('.remove-filter-btn')) {
            const filterRow = e.target.closest('.filter-row');
            filterRowsContainer.removeChild(filterRow);
            filterAndRenderTable();
        }
    });

    ui.addFilterRow(filterRowsContainer, allDrivers, filterAndRenderTable);

    document.getElementById('open-settings-btn').addEventListener('click', () => {
        ui.renderSettingsContent(settings);
        ui.openSettings();
    });
    document.getElementById('create-manual-report-btn').addEventListener('click', () => {
        currentEditingDriverId = null;
        ui.openEditPanel(null, { drivers: driversForDate, allDrivers, settings, driversForDate, overriddenDistances });
    });

    document.querySelectorAll('input[name="filter-logic"]').forEach(radio => {
        radio.addEventListener('change', filterAndRenderTable);
    });

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
    pinModal.addEventListener('click', (e) => {
        if (e.target === pinModal) pinModal.classList.add('hidden');
    });

    document.getElementById('pin-submit-btn').addEventListener('click', async (e) => {
        if (pinInput.value === CORRECT_PIN) {
            pinModal.classList.add('hidden');
            const newSettings = calc.updateSettingsFromUI();
            if (newSettings) {
                settings = newSettings;
                const btn = document.getElementById('save-settings-btn');
                btn.disabled = true;
                btn.innerHTML = 'Saving...';
                await api.saveSettings(settings);
                setTimeout(async () => {
                    settings = await api.loadSettings();
                    filterAndRenderTable();
                    ui.closeSettings();
                    btn.disabled = false;
                    btn.innerHTML = 'Save & Recalculate';
                }, 1500);
            }
        } else {
            pinError.classList.remove('hidden');
            pinInput.value = '';
            pinInput.focus();
        }
    });
    
    pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('pin-submit-btn').click();
    });
    settingsContent.addEventListener('click', e => {
        if (e.target.closest('.add-tier-btn') || e.target.closest('.remove-tier-btn')) {
            const tempSettings = calc.updateSettingsFromUI();
            const section = e.target.closest('[data-tier-key]');
            const key = section.dataset.tierKey;
            
            if (e.target.closest('.add-tier-btn')) {
                const newTier = key === 'speedingRangeTiers' ? {from: 0, to: 0, penalty: 0} : { threshold: 0, bonus: 0 };
                tempSettings[key] = [...(tempSettings[key] || []), newTier];
            } else {
                const row = e.target.closest('.tier-row');
                const index = parseInt(row.dataset.tierIndex, 10);
                tempSettings[key].splice(index, 1);
            }
            ui.renderSettingsContent(tempSettings);
        }
    });

    document.getElementById('close-edit-btn').addEventListener('click', ui.closeEditPanel);
    document.getElementById('edit-overlay').addEventListener('click', ui.closeEditPanel);
    document.getElementById('download-manual-report-btn').addEventListener('click', downloadManualReport);

    tableBody.addEventListener('click', e => {
        const downloadBtn = e.target.closest('.download-btn');
        if (downloadBtn) {
            e.stopPropagation();
            const driver = driversForDate.find(d => d.id == downloadBtn.dataset.driverId);
            if(driver) ui.downloadDriverReport(driver, settings, driversForDate);
            return;
        }
        const editBtn = e.target.closest('.edit-btn');
        if (editBtn) {
            e.stopPropagation();
            currentEditingDriverId = parseInt(editBtn.dataset.driverId);
            ui.openEditPanel(currentEditingDriverId, { drivers: driversForDate, availableContractTypes, allDrivers, settings, driversForDate, overriddenDistances });
            return;
        }
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            e.stopPropagation();
            const driver = driversForDate.find(d => d.id == copyBtn.dataset.driverId);
            if(driver) {
                const reportData = calc.getDriverReportData(driver, settings);
                let explanation = `${driver.name} - FINAL %: ${reportData.totalTpog.toFixed(1)}%\n\n` +
                                  `Base Rate: ${settings.baseRate.toFixed(1)}%\n` +
                                  Object.entries(reportData.bonuses).map(([key, value]) =>
                                      `${key}: ${value.bonus >= 0 ? '+' : ''}${value.bonus.toFixed(1)}%`
                                  ).join('\n');
                navigator.clipboard.writeText(explanation).then(() => ui.showToast());
            }
            return;
        }
        const showHistoryBtn = e.target.closest('.show-history-btn');
        if (showHistoryBtn) {
            e.stopPropagation();
            const driverId = showHistoryBtn.dataset.driverId;
            const driver = driversForDate.find(d => d.id == driverId);
            if (driver) {
                ui.openActivityHistoryModal(driver, mileageData, settings, daysTakenHistory, dispatcherOverrides);
            }
            return;
        }
        const clickedCell = e.target.closest('td');
        if (clickedCell && (clickedCell.dataset.key === 'milesWeek' || clickedCell.dataset.key === 'samsaraDistance')) {
            const row = e.target.closest('tr');
            const driverId = row.dataset.driverId;
            const driver = driversForDate.find(d => d.id == driverId);
            if (!driver) return;

            const payDate = driver.pay_date.split('T')[0];
            const overrideKey = `${driverId}_${payDate}`;
            const distanceType = clickedCell.dataset.key;

            if (distanceType === 'samsaraDistance') {
                if (overriddenDistances[overrideKey] === 'samsaraDistance') {
                    // It's already Samsara, toggle it off
                    delete overriddenDistances[overrideKey];
                    api.saveDistanceOverride(driverId, null, payDate); 
                } else {
                    // It's not Samsara, toggle it on
                    overriddenDistances[overrideKey] = 'samsaraDistance';
                    api.saveDistanceOverride(driverId, 'samsaraDistance', payDate);
                }
            } else { // Clicked on 'milesWeek' (ProLogs)
                // Clicking on Prologs should only ever clear an existing override
                if (overriddenDistances[overrideKey]) {
                    delete overriddenDistances[overrideKey];
                    api.saveDistanceOverride(driverId, null, payDate);
                }
            }

            filterAndRenderTable();
            return;
        }
        const row = e.target.closest('tr');
        if (row && row.dataset.driverId) {
            const driverId = row.dataset.driverId;
            const driver = driversForDate.find(d => d.id == driverId);
            if (driver) {
                ui.openHistoryModal(
                    driver,
                    () => api.fetchSafetyHistory(driver.name),
                    () => api.fetchFuelHistory(driver.name),
                    () => api.fetchPOHistory(driver.name),
                    () => api.fetchFuelPurchaseHistory(driver.name),
                    () => api.fetchChangelogHistory(driver.name),
                    mileageData // Pass the main mileage data to the history modal
                );
            }
        }
    });

    // --- Tooltip handler for MAIN TABLE ---
    tableBody.addEventListener('mouseover', e => {
        const tooltipContainer = e.target.closest('.tooltip-container');
        if (tooltipContainer) {
            const tooltipType = tooltipContainer.dataset.tooltipType;
            let tooltipContent = '';

            if (tooltipType === 'breakdown') {
                const title = tooltipContainer.dataset.tooltipTitle;
                const breakdown = tooltipContainer.dataset.tooltipBreakdown.split('|');
                tooltipContent = `<div class="p-1"><div class="font-bold text-base mb-2 text-slate-100">${title}</div><ul class="space-y-1">`;
                breakdown.forEach(item => {
                    tooltipContent += `<li class="text-xs whitespace-nowrap">${item}</li>`;
                });
                tooltipContent += '</ul></div>';
            } else {
                const text = tooltipContainer.dataset.tooltip;
                if (text) {
                    tooltipContent = text;
                }
            }
            
            if (tooltipContent) {
                globalTooltip.innerHTML = tooltipContent; // Use innerHTML to render the list
                globalTooltip.classList.remove('hidden');
                const rect = tooltipContainer.getBoundingClientRect();
                const tooltipHeight = globalTooltip.offsetHeight;
                const spaceBelow = window.innerHeight - rect.bottom;
                let topPosition = rect.bottom + 8; // Increased spacing
                if (spaceBelow < tooltipHeight + 15) {
                    topPosition = rect.top - tooltipHeight - 8;
                }
                globalTooltip.style.left = `${rect.left + rect.width / 2 - globalTooltip.offsetWidth / 2}px`;
                globalTooltip.style.top = `${topPosition}px`;
            }
        }
    });

    tableBody.addEventListener('mouseout', e => {
        if (e.target.closest('.tooltip-container')) {
            globalTooltip.classList.add('hidden');
        }
    });

    // --- Tooltip handler for ACTIVITY HISTORY MODAL ---
    activityHistoryContent.addEventListener('mouseover', e => {
        const tooltipContainer = e.target.closest('.tooltip-container');
        if (tooltipContainer) {
            const tooltipText = tooltipContainer.dataset.tooltip;
            if (tooltipText) {
                globalTooltip.textContent = tooltipText;
                globalTooltip.classList.remove('hidden');
                const rect = tooltipContainer.getBoundingClientRect();
                const tooltipHeight = globalTooltip.offsetHeight;
                const spaceBelow = window.innerHeight - rect.bottom;
                let topPosition = rect.bottom + 5;
                if (spaceBelow < tooltipHeight + 10) {
                    topPosition = rect.top - tooltipHeight - 5;
                }
                globalTooltip.style.left = `${rect.left + rect.width / 2 - globalTooltip.offsetWidth / 2}px`;
                globalTooltip.style.top = `${topPosition}px`;
            }
        }
    });

    activityHistoryContent.addEventListener('mouseout', e => {
        if (e.target.closest('.tooltip-container')) {
            globalTooltip.classList.add('hidden');
        }
    });

    // --- NEW: Tooltip handler for SETTINGS PANEL ---
    settingsContent.addEventListener('mouseover', e => {
        const tooltipContainer = e.target.closest('.tooltip-container');
        if (tooltipContainer) {
            const tooltipText = tooltipContainer.dataset.tooltip;
            if (tooltipText) {
                globalTooltip.textContent = tooltipText;
                globalTooltip.classList.remove('hidden');
                const rect = tooltipContainer.getBoundingClientRect();
                const tooltipHeight = globalTooltip.offsetHeight;
                const spaceBelow = window.innerHeight - rect.bottom;
                let topPosition = rect.bottom + 5;
                if (spaceBelow < tooltipHeight + 10) {
                    topPosition = rect.top - tooltipHeight - 5;
                }
                globalTooltip.style.left = `${rect.left + rect.width / 2 - globalTooltip.offsetWidth / 2}px`;
                globalTooltip.style.top = `${topPosition}px`;
            }
        }
    });

    settingsContent.addEventListener('mouseout', e => {
        if (e.target.closest('.tooltip-container')) {
            globalTooltip.classList.add('hidden');
        }
    });

    // --- Table Header Listeners ---
    tableHead.addEventListener('click', e => {
        const menuButton = e.target.closest('.menu-button');
        if (menuButton) {
            e.stopPropagation();
            const menu = menuButton.nextElementSibling;
            if (menu) {
                const parentTh = menu.closest('th');
                const isOpening = menu.classList.contains('hidden');
                document.querySelectorAll('.column-menu').forEach(m => {
                    m.classList.add('hidden');
                    m.closest('th')?.classList.remove('menu-open');
                });
                if (isOpening && parentTh) {
                    menu.classList.remove('hidden');
                    parentTh.classList.add('menu-open');
                }
            }
        }
    
        const actionLink = e.target.closest('[data-action]');
        if (actionLink) {
            e.preventDefault();
            const action = actionLink.dataset.action;
            const th = actionLink.closest('th');
            if (!th) return;
            const key = th.dataset.key;
    
            if (action.startsWith('pin') || action === 'unpin') {
                pinnedColumns.left = pinnedColumns.left.filter(k => k !== key);
                pinnedColumns.right = pinnedColumns.right.filter(k => k !== key);
                if (action === 'pin-left') pinnedColumns.left.push(key);
                if (action === 'pin-right') {
                    const actionsIndex = pinnedColumns.right.indexOf('actions');
                    if (actionsIndex !== -1) {
                        pinnedColumns.right.splice(actionsIndex, 0, key);
                    } else {
                        pinnedColumns.right.push(key);
                    }
                }
                filterAndRenderTable();
            }
    
            if (action.startsWith('sort')) {
                const isAsc = action === 'sort-asc';
                driversForDate.sort((a, b) => {
                    let valA, valB;
                    if (key === 'totalTpog') {
                        valA = calc.calculateDriverTPOG(a, settings);
                        valB = calc.calculateDriverTPOG(b, settings);
                    } else if (key === 'mpgPercentile') {
                        valA = a.mpgPercentile;
                        valB = b.mpgPercentile;
                    } else {
                        valA = a[key];
                        valB = b[key];
                    }

                    if (typeof valA === 'number' && typeof valB === 'number') {
                        return isAsc ? valA - valB : valB - valA;
                    }
                    return isAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
                });
    
                const searchTerm = searchInput.value.toLowerCase();
                const selectedContractTypes = [...document.querySelectorAll('.contract-type-checkbox:checked')].map(cb => cb.value);
                const filteredAndSortedDrivers = driversForDate.filter(d =>
                    d.name.toLowerCase().startsWith(searchTerm) &&
                    (selectedContractTypes.length === 0 || selectedContractTypes.includes(d.contract_type))
                );
                ui.renderTable(filteredAndSortedDrivers, { orderedColumnKeys, visibleColumnKeys, pinnedColumns, settings, overriddenDistances });
            }
    
            actionLink.closest('.column-menu').classList.add('hidden');
        }
    });
    
    tableHead.addEventListener('dragstart', e => {
        const th = e.target.closest('th');
        if (th) { draggedColumnKey = th.dataset.key; e.dataTransfer.effectAllowed = 'move'; th.classList.add('dragging'); }
    });
    tableHead.addEventListener('dragover', e => {
        e.preventDefault();
        const th = e.target.closest('th');
        if (th && th.dataset.key !== draggedColumnKey) {
            document.querySelectorAll('th.drag-over').forEach(el => el.classList.remove('drag-over'));
            th.classList.add('drag-over');
        }
    });
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
    tableHead.addEventListener('dragend', () => {
        document.querySelectorAll('th.dragging').forEach(el => el.classList.remove('dragging'));
        draggedColumnKey = null;
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('#general-filter-container') && !e.target.closest('.menu-button') && !e.target.closest('#column-toggle-filter')) {
            generalFilterPanel.classList.add('hidden');
            columnToggleOptions.classList.add('hidden');
            document.querySelectorAll('.column-menu').forEach(m => m.classList.add('hidden'));
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { 
            ui.closeSettings(); 
            ui.closeEditPanel(); 
            ui.closeHistoryModal();
        }
    });

    const historyModal = document.getElementById('history-modal');
    document.getElementById('close-history-btn').addEventListener('click', ui.closeHistoryModal);
    historyModal.addEventListener('click', (e) => {
        // Logic to close modal if overlay is clicked
        if (e.target === historyModal) {
            ui.closeHistoryModal();
            return; // Stop further processing
        }

        // Logic for changelog accordion
        const header = e.target.closest('.changelog-group-header');
        if (header) {
            const content = header.nextElementSibling;
            const icon = header.querySelector('.changelog-chevron');
            if (content && content.classList.contains('changelog-group-content')) {
                content.classList.toggle('hidden');
                icon.classList.toggle('rotate-90');
            }
        }
    });

    const activityHistoryModal = document.getElementById('activity-history-modal');
    document.getElementById('close-activity-history-btn').addEventListener('click', ui.closeActivityHistoryModal);
    activityHistoryModal.addEventListener('click', (e) => {
        if (e.target === activityHistoryModal) ui.closeActivityHistoryModal();
    });
    
    document.querySelector('.history-tab[data-tab="safety"]').parentElement.addEventListener('click', (e) => {
        const tabButton = e.target.closest('.history-tab');
        if (tabButton) {
            ui.switchHistoryTab(tabButton.dataset.tab);
        }
    });
    
    window.addEventListener('resize', () => ui.updateColumnPinning(pinnedColumns));
}

/**
 * Initializes the application by fetching all necessary data and rendering the initial view.
 */
async function initializeApp() {
    settings = await api.loadSettings();
    ui.updateLoadingProgress('15%');
    mileageData = await api.loadMileageData();
    ui.updateLoadingProgress('30%');
    allDrivers = await api.fetchDriverData();
    ui.updateLoadingProgress('45%');
    allSafetyData = await api.loadAllSafetyData();
    ui.updateLoadingProgress('60%');
    financialData = await api.loadFinancialData();
    ui.updateLoadingProgress('70%');
    daysTakenHistory = await api.fetchDaysTakenHistory();
    overriddenDistances = await api.loadDistanceOverrides();
    dispatcherOverrides = await api.loadDispatcherOverrides();
    ui.updateLoadingProgress('80%');

    if (allDrivers) {
        // --- MERGE FINANCIAL DATA ---
        allDrivers.forEach(driver => {
            const payDate = driver.pay_date.split('T')[0];
            const financialRecord = financialData.find(fin => 
                fin.driver_name === driver.name && 
                fin.pay_date === payDate
            );

            if (financialRecord) {
                driver.gross = financialRecord.weekly_gross || driver.gross;
                driver.stubMiles = financialRecord.weekly_miles || 0;
                driver.rpm = financialRecord.weekly_rpm || driver.rpm;
            }
        });
        // --- END MERGE ---

        const payDates = [...new Set(allDrivers.map(d => d.pay_date && d.pay_date.split('T')[0]))].filter(Boolean).sort().reverse();
        payDateSelect.innerHTML = payDates.map(date => `<option value="${date}">${date}</option>`).join('');
        
        ui.populateColumnToggle(orderedColumnKeys, pinnedColumns, (newVisibleColumns) => {
            visibleColumnKeys = newVisibleColumns;
            filterAndRenderTable();
        }, visibleColumnKeys);
        
        filterAndRenderTable();
    } else {
        tableBody.innerHTML = `<tr><td colspan="${Object.keys(columnConfig).length}" class="text-center py-10 text-red-500">Failed to load data.</td></tr>`;
    }

    ui.updateLoadingProgress('100%', true);

    // --- TRIGGER BACKGROUND CACHING ---
    // After the main UI is loaded and interactive, start the quiet background fetch.
    // A slight delay ensures it doesn't interfere with the initial render.
    setTimeout(api.cacheAllHistoryDataInBackground, 1000); 
}

// --- APP START ---
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    initializeEventListeners();
});
