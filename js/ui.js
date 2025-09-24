/**
 * ui.js
 * * Contains all functions that directly manipulate the DOM, such as rendering
 * tables, opening/closing panels, and updating UI elements.
 */
import { calculateMpgPercentile, calculateSpeedingPercentile } from './calculations.js';
import { calculateDriverTPOG, getDriverReportData } from './calculations.js';
import { columnConfig } from './config.js';


const tableHead = document.getElementById('main-table-head');
const tableBody = document.getElementById('driver-table-body');
const settingsPanel = document.getElementById('settings-panel');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsContent = document.getElementById('settings-content');
const editPanel = document.getElementById('edit-panel');
const editOverlay = document.getElementById('edit-overlay');
const editContent = document.getElementById('edit-content');
const toast = document.getElementById('toast');
const loadingOverlay = document.getElementById('loading-overlay');
const progressBar = document.getElementById('progress-bar');

export let historyChart = null;
let groupedHistoryChart = null; // Chart instance for the new grouped view
let safetyChart = null; // Chart instance for the safety tab
let poChart = null; // Chart instance for the PO tab
let fullHistoryData = [];
let historyModalClickListener = null;

// This plugin is now defined globally within the module to be accessible by both chart functions.
const verticalLinePlugin = {
    id: 'verticalLine',
    afterDraw: chart => {
        const activeElements = chart.tooltip.getActiveElements();
        // Add a check to ensure the element exists before accessing its properties
        if (activeElements.length > 0 && activeElements[0] && activeElements[0].element) {
            const x = activeElements[0].element.x;
            // Dynamically get the correct y-axis based on which chart is being drawn
            const yAxis = chart.scales.yFuel || chart.scales.yScore;
            if (!yAxis) return; // Exit if no valid axis is found
            const ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, yAxis.top);
            ctx.lineTo(x, yAxis.bottom);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
            ctx.stroke();
            ctx.restore();
        }
    }
};


/**
 * Renders the main data table header.
 * @param {Array<string>} orderedColumnKeys The current order of column keys.
 * @param {Array<string>} visibleColumnKeys The keys of columns that should be visible.
 * @param {Object} pinnedColumns Object with 'left' and 'right' arrays of pinned column keys.
 */
export function renderTableHeader(orderedColumnKeys, visibleColumnKeys, pinnedColumns) {
    const tr = document.createElement('tr');
    const currentOrderedKeys = [
        ...pinnedColumns.left,
        ...orderedColumnKeys.filter(k => !pinnedColumns.left.includes(k) && !pinnedColumns.right.includes(k)),
        ...pinnedColumns.right
    ].filter(key => visibleColumnKeys.includes(key));

    currentOrderedKeys.forEach(key => {
        const config = columnConfig[key];
        const th = document.createElement('th');
        th.scope = 'col';
        th.dataset.key = key;
        th.draggable = true;
        th.className = `group px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-800 border-b border-slate-700 ${config.class}`;
        const isPinned = pinnedColumns.left.includes(key) || pinnedColumns.right.includes(key);

        th.innerHTML = `
            <div class="flex items-center justify-between w-full gap-1">
                <span class="flex-grow">${config.title}</span>
                ${key !== 'name' && key !== 'actions' ? `
                <div class="relative">
                    <button class="menu-button opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-slate-600">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01"></path></svg>
                    </button>
                    <div class="column-menu absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg hidden text-sm text-left font-normal normal-case">
                        <div class="divide-y divide-slate-200">
                            <div class="flex items-center justify-between px-3 py-2 text-slate-700">
                                <span class="font-medium">Pin</span>
                                <div class="flex items-center gap-1">
                                    <a href="#" class="p-1 rounded hover:bg-slate-200" data-action="pin-left" title="Pin to left"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 17l-5-5m0 0l5-5m-5 5h12"></path></svg></a>
                                    <a href="#" class="p-1 rounded hover:bg-slate-200" data-action="pin-right" title="Pin to right"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg></a>
                                </div>
                            </div>
                            <div class="flex items-center justify-between px-3 py-2 text-slate-700">
                                <span class="font-medium">Sort</span>
                                <div class="flex items-center gap-1">
                                    <a href="#" class="p-1 rounded hover:bg-slate-200" data-action="sort-asc" title="Sort Ascending"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9M3 12h9m-9 4h13m4-4l-3-3m0 0l-3 3m3-3v12"></path></svg></a>
                                    <a href="#" class="p-1 rounded hover:bg-slate-200" data-action="sort-desc" title="Sort Descending"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9M3 12h9m-9 4h13m4 4l-3 3m0 0l-3-3m3 3V8"></path></svg></a>
                                </div>
                            </div>
                            ${isPinned ? `<a href="#" class="flex items-center gap-2 px-4 py-2 text-slate-700 hover:bg-slate-100" data-action="unpin"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg><span>Unpin</span></a>` : ''}
                        </div>
                    </div>
                </div>` : ''}
            </div>`;
        tr.appendChild(th);
    });
    tableHead.innerHTML = '';
    tableHead.appendChild(tr);
}

/**
 * Renders the rows of the main data table.
 * @param {Array<Object>} data The array of driver data to render.
 * @param {Object} state The current application state.
 */
export function renderTable(data, state) {
    const { orderedColumnKeys, visibleColumnKeys, pinnedColumns, settings, overriddenDistances } = state;
    renderTableHeader(orderedColumnKeys, visibleColumnKeys, pinnedColumns);
    tableBody.innerHTML = '';
    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="${visibleColumnKeys.length}" class="text-center py-10 text-slate-500">No drivers for selected date.</td></tr>`;
        return;
    }
    const currentOrderedKeys = [
        ...pinnedColumns.left,
        ...orderedColumnKeys.filter(k => !pinnedColumns.left.includes(k) && !pinnedColumns.right.includes(k)),
        ...pinnedColumns.right
    ].filter(key => visibleColumnKeys.includes(key));

    data.forEach((driver, index) => {
        const tr = document.createElement('tr');
        tr.className = 'cursor-pointer'; // Add cursor to indicate the row is clickable
        tr.dataset.driverId = driver.id; // Attach the ID directly to the row
        tr.className = index % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/50';

        currentOrderedKeys.forEach(key => {
            const config = columnConfig[key];
            const cell = (key === 'name') ? document.createElement('th') : document.createElement('td');
            if (key === 'name') cell.scope = 'row';
            cell.dataset.key = key;
            
            let cellClass = `px-4 py-2 whitespace-nowrap ${config.class}`;
            const payDate = driver.pay_date.split('T')[0];
            const overrideKey = `${driver.id}_${payDate}`;
            const activeOverride = overriddenDistances[overrideKey];
            if (key === 'milesWeek') {
                cellClass += activeOverride === 'samsaraDistance' ? ' distance-prologs-inactive' : ' distance-prologs-active';
            } else if (key === 'samsaraDistance') {
                cellClass += activeOverride === 'samsaraDistance' ? ' distance-samsara-active' : ' distance-samsara-inactive';
            }
            cell.className = cellClass;
            
            let content = driver[key];
            if (key === 'name') {
                let icons = '<div class="flex items-center gap-1.5">';
                if (driver.milesWeek > 0) {
                    icons += '<div class="tooltip-container" data-tooltip="ProLogs data available"><div class="data-indicator indicator-p">P</div></div>';
                }
                if (driver.safetyScore > 0) {
                    icons += '<div class="tooltip-container" data-tooltip="Safety/Samsara data available"><div class="data-indicator indicator-s">S</div></div>';
                }
                icons += '</div>';
                content = `<div class="flex items-center gap-2">${driver.name}${icons}</div>`;
            }
            
            const isTpogContract = driver.contract_type === 'TPOG';
            const reportData = isTpogContract ? getDriverReportData(driver, settings) : null;

            if (key === 'availableOffDays') {
                content = reportData ? reportData.availableOffDays : '-';
            } else if (key === 'escrowDeduct') {
                if (reportData && reportData.escrowDeduct > 0) {
                    content = `-$${reportData.escrowDeduct.toFixed(2)}`;
                    cell.style.color = '#f87171'; // Red color for deductions
                } else {
                    content = reportData ? `$${reportData.escrowDeduct.toFixed(2)}` : '-';
                }
            } else if (key === 'offDays') {
                content = driver.offDays || 0;
            } else if (key === 'bonuses') {
                if (!isTpogContract || !reportData) {
                    content = '-';
                } else {
                    const updatedReportData = getDriverReportData(driver, settings);
                    const bonusValue = updatedReportData.totalPositiveBonuses;
                    content = `+${bonusValue.toFixed(1)}%`;
                    if (bonusValue > 0) {
                        cell.style.color = '#4ade80'; // Green color for bonuses
                    }
                }
            } else if (key === 'penalties') {
                if (!isTpogContract || !reportData) {
                    content = '-';
                } else {
                    const updatedReportData = getDriverReportData(driver, settings);
                    const penaltyValue = updatedReportData.totalPenalties;
                    content = `${penaltyValue.toFixed(1)}%`;
                    if (penaltyValue < 0) {
                        cell.style.color = '#f87171'; // Red color for penalties
                    }
                }
            } else if (key === 'totalTpog') {
                if (!isTpogContract || !reportData) {
                    content = '-';
                } else {
                    const tpog = calculateDriverTPOG(driver, settings);
                    content = `<span class="font-bold" style="color: #e2b340;">${tpog.toFixed(1)}%</span>`;
                }
            } else if (key === 'actions') {
                if (!isTpogContract) {
                    content = '-';
                } else {
                    content = `<div class="flex items-center justify-center gap-2">
                                <button class="copy-btn p-0 rounded-full hover:bg-slate-700" data-driver-id="${driver.id}" title="Copy Report Explanation"><svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                                <button class="edit-btn p-0 rounded-full hover:bg-slate-700" data-driver-id="${driver.id}" title="Edit & Download Report"><svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z"></path></svg></button>
                                <button class="download-btn p-0 rounded-full hover:bg-slate-700" data-driver-id="${driver.id}" title="Download Automatic Report"><svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></button>
                           </div>`;
                }
            // WITH THIS
        } else if (key === 'weeklyActivity') {
            if (driver.weeklyActivity && driver.weeklyActivity.length === 7) {
                let activityBlocksHtml = '';
        
                driver.weeklyActivity.forEach(activity => {
                    let colorClass = 'activity-red'; // Default to red
                    const statuses = (activity.statuses || '').toUpperCase();
        
                    switch (settings.weeksOutMethod) {
                        case 'daysOff':
                            if (statuses.includes('DAY_OFF')) {
                                colorClass = 'activity-red';
                            } else if (statuses.includes('WITHOUT_LOAD')) {
                                colorClass = 'activity-orange';
                            } else if (statuses.includes('ACTIVE')) {
                                colorClass = 'activity-green';
                            } else {
                                 colorClass = activity.mileage > 0 ? 'activity-green' : 'activity-red';
                            }
                            break;
                        case 'daily':
                            colorClass = activity.mileage >= (settings.weeksOutMileageThreshold || 0) ? 'activity-green' : 'activity-red';
                            break;
                        case 'weekly':
                        default:
                            colorClass = activity.mileage > 0 ? 'activity-green' : 'activity-red';
                            break;
                    }
        
                    const miles = activity.mileage.toFixed(0);
                    const mileLabel = miles === "1" ? "mile" : "mi";
                    let tooltipText = `${activity.fullDate} - ${miles} ${mileLabel}. Status: ${activity.statuses}`;
                    if (activity.isChanged) {
                        tooltipText = `${activity.fullDate} - ${miles} ${mileLabel}. Status: ${activity.tooltipStatus}`;
                    }
        
                    const overrideClass = activity.isChanged ? 'dispatch-override' : '';
        
                    activityBlocksHtml += `<div class="tooltip-container" data-tooltip="${tooltipText}">
                                        <div class="weekly-activity-block ${colorClass} ${overrideClass}">${activity.day}</div>
                                    </div>`;
                });
        
                const checkmarkHtml = driver.isDispatcherReviewed ?
                    `<div class="tooltip-container" data-tooltip="Reviewed by Dispatcher">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                        </svg>
                    </div>` : '';
        
                content = `<div class="flex items-center justify-center gap-2">
                            <button class="show-history-btn p-0 rounded-full hover:bg-slate-700" data-driver-id="${driver.id}" title="Show Historical Activity">
                                <svg class="w-5 h-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                </svg>
                            </button>
                            <div class="flex justify-center items-center gap-0.5">${activityBlocksHtml}</div>
                            ${checkmarkHtml}
                           </div>`;
            } else {
                content = '-';
            }
            
            
            } else if (key === 'mpg') {
                content = parseFloat(driver.mpg).toFixed(1);
            } else if (key === 'mpgPercentile') {
                content = `${parseFloat(driver.mpgPercentile)}%`;
            } else if (key === 'samsaraDistance') {
                content = driver.samsaraDistance > 0 ? driver.samsaraDistance : '-';
            } else if (key === 'gross' || key === 'rpm' || key === 'estimatedNet') {
                const value = parseFloat(content);
                if (value === 0) {
                    content = '-';
                } else {
                    content = `$${value.toFixed(2)}`;
                }
            } else if (config.type === 'percent') {
                content = `${content}%`;
            } else if (key === 'speeding_over11mph' || key === 'speeding_over16mph') {
                content = driver[key] || 0;
            }

            cell.innerHTML = content;
            tr.appendChild(cell);
        });
        tableBody.appendChild(tr);
    });
    // **FIX:** This function is now called directly to prevent the flicker.
    updateColumnPinning(pinnedColumns);
}

/**
 * Applies sticky positioning styles to pinned columns.
 * @param {Object} pinnedColumns Object with 'left' and 'right' arrays of pinned column keys.
 */
export function updateColumnPinning(pinnedColumns) {
    const allCells = document.querySelectorAll('#main-table th, #main-table td');
    allCells.forEach(c => {
        c.classList.remove('pinned-left', 'pinned-right');
        c.style.left = '';
        c.style.right = '';
    });
    let leftOffset = 0;
    pinnedColumns.left.forEach(key => {
        const headerCell = document.querySelector(`th[data-key="${key}"]`);
        if (!headerCell) return;
        const cells = document.querySelectorAll(`[data-key="${key}"]`);
        cells.forEach(cell => {
            cell.classList.add('pinned-left');
            cell.style.left = `${leftOffset}px`;
        });
        leftOffset += headerCell.offsetWidth;
    });
    let rightOffset = 0;
    [...pinnedColumns.right].reverse().forEach(key => {
        const headerCell = document.querySelector(`th[data-key="${key}"]`);
        if (!headerCell) return;
        const cells = document.querySelectorAll(`[data-key="${key}"]`);
        cells.forEach(cell => {
            cell.classList.add('pinned-right');
            cell.style.right = `${rightOffset}px`;
        });
        rightOffset += headerCell.offsetWidth;
    });
}

const createRangeBonusEditor = (key, title, tooltipText, settings) => {
    const tiers = settings[key] || [];
    const tierRows = tiers.map((tier, index) => `
        <div class="tier-row grid grid-cols-[auto_auto_auto_auto] justify-start gap-x-3 items-center" data-tier-index="${index}">
            <input type="number" class="settings-input w-24" value="${tier.from ?? ''}" data-type="from" placeholder="e.g. 2">
            <input type="number" class="settings-input w-24" value="${tier.to !== Infinity ? (tier.to ?? '') : ''}" data-type="to" placeholder="e.g. 10">
            <input type="number" step="0.1" class="settings-input w-24" value="${tier.penalty ?? ''}" data-type="penalty" placeholder="e.g. -1.0">
            <button type="button" class="remove-tier-btn text-slate-500 hover:text-red-500 p-1 rounded-full transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
        </div>`).join('');

    let tooltipHtml = tooltipText ? `
        <div class="tooltip-container ml-2" data-tooltip="${tooltipText}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>` : '';

    return `
        <div class="space-y-3" data-tier-key="${key}">
            <div class="flex items-center"><h3 class="text-base font-semibold text-slate-100">${title}</h3>${tooltipHtml}</div>
            <div>
                <div class="grid grid-cols-[auto_auto_auto_auto] justify-start gap-x-3 items-center text-xs font-medium text-slate-400 px-1">
                    <span>From (Events)</span><span>To (Events)</span><span>Penalty (%)</span><span></span>
                </div>
                <div class="space-y-2 mt-2">${tierRows}</div>
                <button type="button" class="add-tier-btn text-sm font-semibold text-blue-500 hover:text-blue-400 mt-2">+ Add Tier</button>
            </div>
        </div>`;
};

const createTieredBonusEditor = (key, title, unit, tooltipText, settings) => {
    const tiers = settings[key] || [];
    const tierRows = tiers.map((tier, index) => `
        <div class="tier-row grid grid-cols-[1fr_1fr_auto] gap-3 items-center" data-tier-index="${index}">
            <input type="number" class="settings-input" value="${tier.threshold ?? ''}" data-type="threshold" placeholder="e.g. 6">
            <input type="number" step="0.1" class="settings-input" value="${tier.bonus ?? ''}" data-type="bonus" placeholder="e.g. 5.0">
            <button type="button" class="remove-tier-btn text-slate-500 hover:text-red-500 p-1 rounded-full transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
        </div>`).join('');

    let tooltipHtml = tooltipText ? `
        <div class="tooltip-container ml-2" data-tooltip="${tooltipText}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>` : '';

    let includeZerosCheckboxHtml = key === 'speedingPercentileTiers' ? `
        <div class="flex items-center space-x-2 mt-3 mb-3">
            <input type="checkbox" id="include-speeding-zeros" class="h-4 w-4 rounded border-slate-500 text-blue-600 focus:ring-blue-500" ${settings.includeZerosInSpeedingCalc ? 'checked' : ''}>
            <label for="include-speeding-zeros" class="text-sm text-slate-300">Include Zeros</label>
            <div class="tooltip-container" data-tooltip="When checked, drivers with zero speeding alerts are included in the percentile calculation. This generally results in lower percentiles for drivers who do have alerts.">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
        </div>` : '';

    return `
        <div class="space-y-3" data-tier-key="${key}">
            <div class="flex items-center"><h3 class="text-base font-semibold text-slate-100">${title}</h3>${tooltipHtml}</div>
            <div class="grid grid-cols-[1fr_1fr_auto] gap-3 items-center text-xs font-medium text-slate-400 px-1"><span>Threshold (${unit})</span><span>Bonus (%)</span></div>
            <div class="space-y-2">${tierRows}</div>
            ${includeZerosCheckboxHtml}
            <button type="button" class="add-tier-btn text-sm font-semibold text-blue-500 hover:text-blue-400">+ Add Tier</button>
        </div>`;
};

/**
 * Renders the entire content of the settings panel based on the current settings.
 * @param {Object} settings The current application settings.
 */
export function renderSettingsContent(settings) {
    const tooltipText = 'The system applies the bonus/penalty for the highest tier the driver has passed. For example, a percentile of 89% would receive the reward for the 80% tier.';
    const speedingMethod = settings.speedingPenaltyMethod || 'percentile';
    const weeksOutMethod = settings.weeksOutMethod || 'daily';
    const daysOffTooltipText = "A day is counted as a DAY_OFF if: Status is TIME_OFF and there is no load, OR Status is DROP_LIKELY and the truck is DROPPED.";

    settingsContent.innerHTML = `
        <div class="bg-slate-800 p-5 rounded-lg shadow-sm border border-slate-700">
            <h2 class="text-lg font-bold text-slate-100 border-b border-slate-700 pb-3 mb-3">Base Rate</h2>
            <div>
                <h3 class="text-base font-semibold text-slate-100">Base Rate</h3>
                <p class="text-xs text-slate-400 mt-0.5">The starting percentage for all drivers.</p>
                <input type="number" id="baseRate" class="settings-input mt-2" value="${settings.baseRate}">
            </div>
        </div>
        <div class="bg-slate-800 p-5 rounded-lg shadow-sm border border-slate-700 space-y-4">
            <h2 class="text-lg font-bold text-slate-100 border-b border-slate-700 pb-3">Performance Bonuses</h2>
            <div>
                <h3 class="text-base font-semibold text-slate-100">Weeks Out Policy</h3>
                <p class="text-xs text-slate-400 mt-0.5 mb-3">Define the criteria for a week to be counted as "out".</p>
                
                <div class="mb-4">
                    <label class="block text-xs text-slate-400 mb-2">Calculation Method</label>
                    <div class="flex items-center space-x-6">
                        <label class="flex items-center space-x-2 cursor-pointer">
                            <input type="radio" name="weeksOutMethod" value="daily" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-500" ${weeksOutMethod === 'daily' ? 'checked' : ''}>
                            <span class="text-sm text-slate-300">Daily</span>
                        </label>
                        <label class="flex items-center space-x-2 cursor-pointer">
                            <input type="radio" name="weeksOutMethod" value="weekly" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-500" ${weeksOutMethod === 'weekly' ? 'checked' : ''}>
                            <span class="text-sm text-slate-300">Weekly</span>
                        </label>
                        <label class="flex items-center space-x-2 cursor-pointer">
                            <input type="radio" name="weeksOutMethod" value="daysOff" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-500" ${weeksOutMethod === 'daysOff' ? 'checked' : ''}>
                            <span class="text-sm text-slate-300">No Days Off</span>
                             <div class="tooltip-container" data-tooltip="${daysOffTooltipText}">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                        </label>
                    </div>
                </div>

                <div id="weeks-out-daily-settings" class="grid grid-cols-2 gap-3 mt-2 ${weeksOutMethod === 'daily' ? '' : 'hidden'}">
                    <div><label class="block text-xs text-slate-400 mb-1">Min. Mileage for an Active Day</label><input type="number" id="weeksOutMileageThreshold" class="settings-input" value="${settings.weeksOutMileageThreshold || 0}"></div>
                    <div><label class="block text-xs text-slate-400 mb-1">Min. Active Days for a Week Out</label><input type="number" id="weeksOutActiveDays" class="settings-input" value="${settings.weeksOutActiveDays || 0}"></div>
                </div>

                <div id="weeks-out-weekly-settings" class="mt-2 ${weeksOutMethod === 'weekly' ? '' : 'hidden'}">
                     <label class="block text-xs text-slate-400 mb-1">Min. Weekly Miles for a Week Out</label>
                     <input type="number" id="weeksOutWeeklyMileage" class="settings-input" value="${settings.weeksOutWeeklyMileage || 0}">
                </div>

                <div class="flex items-center mt-4">
                    <input type="checkbox" id="weeksOutResetOnDaysOff" class="h-4 w-4 rounded border-slate-500 text-blue-600 focus:ring-blue-500" ${settings.weeksOutResetOnDaysOff ? 'checked' : ''}>
                    <label for="weeksOutResetOnDaysOff" class="ml-2 block text-sm text-slate-300">Reset streak if any days off are taken</label>
                </div>
            </div>
            <hr class="border-slate-700">
            ${createTieredBonusEditor('weeksOutTiers', 'Weeks Out Bonus', 'Weeks', '', settings)}
        </div>
        <div class="bg-slate-800 p-5 rounded-lg shadow-sm border border-slate-700 space-y-4">
            <h2 class="text-lg font-bold text-slate-100 border-b border-slate-700 pb-3">Safety</h2>
            <div>
                <h3 class="text-base font-semibold text-slate-100">Safety Score Bonus</h3>
                <p class="text-xs text-slate-400 mt-0.5">Bonus if score is at or above a threshold and weekly miles are met.</p>
                <div class="space-y-3 mt-2">
                    <div class="grid grid-cols-2 gap-3">
                        <div><label class="block text-xs text-slate-400 mb-1">Score >= (%)</label><input type="number" id="safetyScoreThreshold" class="settings-input" value="${settings.safetyScoreThreshold}"></div>
                        <div><label class="block text-xs text-slate-400 mb-1">Bonus (%)</label><input type="number" step="0.1" id="safetyScoreBonus" class="settings-input" value="${settings.safetyScoreBonus}"></div>
                    </div>
                    <div><label class="block text-xs text-slate-400 mb-1">Min Miles/Wk for Bonus</label><input type="number" id="safetyScoreMileageThreshold" class="settings-input" value="${settings.safetyScoreMileageThreshold}"></div>
                    <div class="flex items-center mt-2"><input type="checkbox" id="safetyBonusForfeitedOnSpeeding" class="h-4 w-4 rounded border-slate-500 text-blue-600 focus:ring-blue-500" ${settings.safetyBonusForfeitedOnSpeeding ? 'checked' : ''}><label for="safetyBonusForfeitedOnSpeeding" class="ml-2 block text-sm text-slate-300">Forfeit bonus if speeding occurs</label></div>
                </div>
            </div>
            <hr class="border-slate-700">
            <div>
                <h3 class="text-base font-semibold text-slate-100 mb-3">Speeding Penalty Method</h3>
                <div class="flex items-center space-x-6">
                    <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="speedingPenaltyMethod" value="percentile" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-500" ${speedingMethod === 'percentile' ? 'checked' : ''}><span class="text-sm text-slate-300">Percentile</span></label>
                    <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="speedingPenaltyMethod" value="perEvent" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-500" ${speedingMethod === 'perEvent' ? 'checked' : ''}><span class="text-sm text-slate-300">Per Event</span></label>
                    <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="speedingPenaltyMethod" value="range" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-500" ${speedingMethod === 'range' ? 'checked' : ''}><span class="text-sm text-slate-300">Range</span></label>
                </div>
            </div>
            <div id="speeding-percentile-settings" class="${speedingMethod === 'percentile' ? '' : 'hidden'}">${createTieredBonusEditor('speedingPercentileTiers', 'Penalty by Percentile', '%-ile', 'Applies a penalty for drivers with 2 or more speeding alerts based on their percentile. A higher percentile means worse speeding.', settings)}</div>
            <div id="speeding-per-event-settings" class="space-y-3 ${speedingMethod === 'perEvent' ? '' : 'hidden'}">
                 <h3 class="text-base font-semibold text-slate-100">Penalty Per Event</h3>
                 <p class="text-xs text-slate-400 mt-0.5">Applies a fixed penalty for each event after a minimum is met.</p>
                 <div class="grid grid-cols-2 gap-3">
                    <div><label class="block text-xs text-slate-400 mb-1">Minimum events to start deduction</label><input type="number" id="speedingPerEventMinimum" class="settings-input" value="${settings.speedingPerEventMinimum || 2}"></div>
                    <div><label class="block text-xs text-slate-400 mb-1">Deduction per event (%)</label><input type="number" step="0.1" id="speedingPerEventPenalty" class="settings-input" value="${settings.speedingPerEventPenalty || -1.0}"></div>
                 </div>
            </div>
            <div id="speeding-range-settings" class="${speedingMethod === 'range' ? '' : 'hidden'}">${createRangeBonusEditor('speedingRangeTiers', 'Penalty by Range', 'Defines penalty based on the number of speeding events.', settings)}</div>
        </div>
        <div class="bg-slate-800 p-5 rounded-lg shadow-sm border border-slate-700 space-y-4">
             <div class="flex items-center">
                <h2 class="text-lg font-bold text-slate-100">Fuel Efficiency (Percentile)</h2>
                <div class="tooltip-container ml-2" data-tooltip="${tooltipText}"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
            </div>
             ${createTieredBonusEditor('mpgPercentileTiers', '', '%-ile', '', settings)}
        </div>
        <div class="bg-slate-800 p-5 rounded-lg shadow-sm border border-slate-700 space-y-4">
            <h2 class="text-lg font-bold text-slate-100 border-b border-slate-700 pb-3">Tenure (Cumulative)</h2>
            ${createTieredBonusEditor('tenureMilestones', 'Retention Milestones', 'Weeks', '', settings)}
        </div>
        <div class="bg-slate-800 p-5 rounded-lg shadow-sm border border-slate-700 space-y-4">
            <h2 class="text-lg font-bold text-slate-100 border-b border-slate-700 pb-3">Other Policies</h2>
            <div>
                <h3 class="text-base font-semibold text-slate-100">Time Off</h3>
                <div class="grid grid-cols-2 gap-3 mt-2">
                    <div><label class="block text-xs text-slate-400 mb-1">Base Days Off</label><input type="number" id="timeOffBaseDays" class="settings-input" value="${settings.timeOffBaseDays || 3}"></div>
                    <div><label class="block text-xs text-slate-400 mb-1">Start After Weeks</label><input type="number" id="timeOffStartAfterWeeks" class="settings-input" value="${settings.timeOffStartAfterWeeks || 3}"></div>
                    <div><label class="block text-xs text-slate-400 mb-1">Weeks per Additional Day</label><input type="number" id="timeOffWeeksPerDay" class="settings-input" value="${settings.timeOffWeeksPerDay || 1}"></div>
                </div>
            </div>
            <hr class="border-slate-700">
            <div>
                <h3 class="text-base font-semibold text-slate-100">Escrow Deductions</h3>
                 <div class="grid grid-cols-1 gap-3 mt-2">
                    <div><label class="block text-xs text-slate-400 mb-1">Deduction per Day ($)</label><input type="number" id="escrowDeductionAmount" class="settings-input" value="${settings.escrowDeductionAmount || 300}"></div>
                </div>
            </div>
        </div>
    `;

    document.querySelectorAll('input[name="speedingPenaltyMethod"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const selectedMethod = e.target.value;
            document.getElementById('speeding-percentile-settings').classList.toggle('hidden', selectedMethod !== 'percentile');
            document.getElementById('speeding-per-event-settings').classList.toggle('hidden', selectedMethod !== 'perEvent');
            document.getElementById('speeding-range-settings').classList.toggle('hidden', selectedMethod !== 'range');
        });
    });

    document.querySelectorAll('input[name="weeksOutMethod"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const selectedMethod = e.target.value;
            document.getElementById('weeks-out-daily-settings').classList.toggle('hidden', selectedMethod !== 'daily');
            document.getElementById('weeks-out-weekly-settings').classList.toggle('hidden', selectedMethod !== 'weekly');
        });
    });
}

/** Opens the settings panel. */
export function openSettings() {
    settingsPanel.classList.add('open');
    settingsOverlay.classList.remove('hidden');
}

/** Closes the settings panel. */
export function closeSettings() {
    settingsPanel.classList.remove('open');
    settingsOverlay.classList.add('hidden');
}

/**
 * Generates and triggers the download of a driver report image.
 * @param {Object} driverData The driver data for the report.
 * @param {Object} settings The application settings.
 */
export function downloadDriverReport(driverData, settings, driversForDate) {
    const formatNumber = (num) => (num % 1 === 0 ? num.toFixed(0) : num.toFixed(1));
    const formatCurrency = (num) => {
        const numericValue = parseFloat(num);
        if (isNaN(numericValue)) {
            return '$0';
        }
        const roundedNum = Math.round(numericValue);
        if (roundedNum === 0) return '$0';
        return `-$${Math.abs(roundedNum)}`;
    };
    const getTierBgColor = (tier) => {
        if (tier > 2.0) return '#52856A'; if (tier > 1.0) return '#44715A'; if (tier > 0) return '#375D4A';
        if (tier < -2.0) return '#7D4141'; if (tier < -1.0) return '#914E4E'; if (tier < 0) return '#A35B5B';
        return '#475569';
    };
    const reportData = getDriverReportData(driverData, settings);

    // **FIX:** Check for manually entered values and override the calculated ones.
    if (driverData.hasOwnProperty('escrowDeduct')) {
        reportData.escrowDeduct = driverData.escrowDeduct;
    }
    if (driverData.hasOwnProperty('availableOffDays')) {
        reportData.availableOffDays = driverData.availableOffDays;
    }


    const reportDate = driverData.pay_date.split('T')[0];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    let performanceCards = [
        { title: 'Tenure', titleIcon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 002-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', value: reportData.bonuses['Tenure'].bonus, barTiers: [0, ...settings.tenureMilestones.map((_, i) => settings.tenureMilestones.slice(0, i + 1).reduce((sum, m) => sum + m.bonus, 0))], type: 'tenure' },
        { title: 'Weeks Out', titleIcon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z', value: reportData.bonuses['Weeks Out'].bonus, barTiers: [...new Set(settings.weeksOutTiers.map(t => t.bonus))].sort((a, b) => a - b), type: 'weeksOut' },
        { title: 'Fuel Efficiency', titleIcon: 'M7 2h6a1 1 0 011 1v15a2 2 0 01-2 2H8a2 2 0 01-2-2V3a1 1 0 011-1zm10 4v12a2 2 0 002 2h1a1 1 0 001-1v-9a2 2 0 00-2-2h-2zM7 7h6', value: reportData.bonuses['Fuel Efficiency'].bonus, barTiers: [...new Set(settings.mpgPercentileTiers.map(t => t.bonus))].sort((a, b) => a - b), type: 'fuel' },
        { title: 'Speeding', titleIcon: 'M13 10V3L4 14h7v7l9-11h-7z', value: reportData.bonuses['Speeding Penalty'].bonus, barTiers: [0, ...settings.speedingPercentileTiers.map(t => t.bonus)].sort((a, b) => a - b), type: 'speeding' },
        { title: 'Safety Score', titleIcon: 'M12 2L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3z', viewBox: '0 0 24 24', value: reportData.bonuses['Safety Score'].bonus, barTiers: [0, settings.safetyScoreBonus], type: 'safety' }
    ];

    performanceCards.forEach(card => {
        switch (card.type) {
             case 'tenure':
                const tenureBonus = reportData.bonuses['Tenure'].bonus;
                const sortedMilestones = [...(settings.tenureMilestones || [])].sort((a,b) => a.threshold - b.threshold);
                const nextTenure = sortedMilestones.find(m => m.threshold > driverData.tenure);
                if (tenureBonus > 0) { card.description = `Bonus for your ${driverData.tenure} weeks of loyalty.`; } else { card.description = `Currently at ${driverData.tenure} weeks, no bonus applied.`; }
                card.infoText = nextTenure ? `Next bonus milestone at ${nextTenure.threshold} weeks.` : 'Max tenure bonus reached.';
                break;
             case 'speeding': const speedingMethod = settings.speedingPenaltyMethod || 'percentile'; const numAlerts = driverData.speedingAlerts; const penaltyBonus = reportData.bonuses['Speeding Penalty'].bonus; switch (speedingMethod) { case 'perEvent': const minEvents = settings.speedingPerEventMinimum || 2; if (numAlerts < minEvents) { card.description = `${numAlerts} speeding ${numAlerts === 1 ? 'alert' : 'alerts'}. No penalty applied.`; card.infoText = `Stay below ${minEvents} alerts to avoid penalties.`; } else { const penaltyPer = settings.speedingPerEventPenalty || -1.0; const penalizedEvents = numAlerts - (minEvents - 1); card.description = `This week, ${penalizedEvents} of your ${numAlerts} alerts were penalized at ${penaltyPer}%.`; card.infoText = `To avoid deductions, keep alerts under ${minEvents}.`; } break; case 'range': if (penaltyBonus === 0) { card.description = `${numAlerts} speeding ${numAlerts === 1 ? 'alert' : 'alerts'}.`; card.infoText = 'Good job, no penalty applied for this range.'; } else { const sortedTiers = (settings.speedingRangeTiers || []).sort((a, b) => a.from - b.from); let activeTier = null; for (const tier of sortedTiers) { if (numAlerts >= tier.from && numAlerts <= (tier.to || Infinity)) { activeTier = tier; break; } } if (activeTier) { const rangeText = activeTier.to === Infinity ? `${activeTier.from}+` : `${activeTier.from}-${activeTier.to}`; card.description = `To clear the penalty you got for ${numAlerts} alerts (${rangeText} tier), keep future alerts to 1 or fewer.`; card.infoText = ''; } else { card.description = `${numAlerts} speeding ${numAlerts === 1 ? 'alert' : 'alerts'}.`; card.infoText = 'No penalty applied for this range.'; } } break; case 'percentile': default: if (penaltyBonus === 0) { card.description = `${numAlerts} speeding ${numAlerts === 1 ? 'alert' : 'alerts'}.`; card.infoText = 'Good job, no speeding penalty applied.'; } else { card.description = `Your ${numAlerts} alerts mean you performed worse than ${driverData.speedingPercentile}% of drivers. To clear this penalty, keep future alerts to 1 or fewer.`; card.infoText = ''; } break; } break;
             case 'fuel':
                 const currentMpg = parseFloat(driverData.mpg);
                 if (reportData.bonuses['Fuel Efficiency'].bonus >= 0) {
                     card.description = `${currentMpg.toFixed(1)} MPG puts you better than ${driverData.mpgPercentile}% of drivers.`;
                 } else {
                     card.description = `${currentMpg.toFixed(1)} MPG puts you worse than ${100 - driverData.mpgPercentile}% of drivers.`;
                 }
                 const currentPercentile = driverData.mpgPercentile;
                 const currentFuelBonus = reportData.bonuses['Fuel Efficiency'].bonus;
                 const sortedTiers = [...settings.mpgPercentileTiers].sort((a, b) => a.threshold - b.threshold);
                 let infoText = '';
                 let targetTier = null;
                 if (currentFuelBonus < 0) {
                     targetTier = sortedTiers.find(t => t.bonus >= 0);
                 } else {
                     targetTier = sortedTiers.find(t => t.bonus > currentFuelBonus);
                 }

                 if (targetTier && driversForDate && driversForDate.length > 0) {
                     const targetPercentile = targetTier.threshold;
                     const allMpgValues = driversForDate.map(d => parseFloat(d.mpg)).filter(mpg => mpg > 0).sort((a, b) => a - b);
                     let targetMpg = 0;

                     if (allMpgValues.length > 1) {
                         const targetIndex = Math.ceil((targetPercentile / 100) * (allMpgValues.length - 1));
                         targetMpg = allMpgValues[targetIndex];
                     } else if (allMpgValues.length === 1) {
                        targetMpg = allMpgValues[0];
                     }

                     if (targetMpg > 0 && targetMpg > currentMpg) {
                         if (currentFuelBonus < 0) {
                             infoText = `Reach ${targetMpg.toFixed(1)} MPG to remove the penalty.`;
                         } else {
                             infoText = `Reach ${targetMpg.toFixed(1)} MPG for a +${targetTier.bonus.toFixed(1)}% bonus.`;
                         }
                     } else {
                         infoText = 'Keep up the great work!';
                     }
                 } else if (targetTier) {
                    // Fallback to original estimation if full driver data isn't available
                    const percentileDifference = Math.max(0, targetTier.threshold - currentPercentile);
                    const requiredMpgImprovement = (percentileDifference / 10) * 0.75;
                    const estimatedTargetMpg = currentMpg + requiredMpgImprovement;
                    if (currentFuelBonus < 0) {
                        infoText = `Reach ~${estimatedTargetMpg.toFixed(1)} MPG to remove the penalty.`;
                    } else {
                        infoText = `Reach ~${estimatedTargetMpg.toFixed(1)} MPG for a +${targetTier.bonus.toFixed(1)}% bonus.`;
                    }
                 } else {
                     infoText = `Maximum fuel bonus reached.`;
                 }
                 card.infoText = infoText;
                 card.combinedText = `${card.description} ${card.infoText}`;
                 break;
             case 'safety': const bonusAwarded = reportData.bonuses['Safety Score'].bonus > 0; const scoreMet = driverData.safetyScore >= settings.safetyScoreThreshold; const milesMet = driverData.milesWeek >= settings.safetyScoreMileageThreshold; const hasSpeeding = driverData.speedingAlerts > 0; if (bonusAwarded) { card.description = 'Good score and miles requirement met.'; card.infoText = 'Bonus requirements met.'; } else if (!scoreMet) { card.description = `Score is ${driverData.safetyScore}%. Need ${settings.safetyScoreThreshold}% to qualify.`; card.infoText = `Improve score to earn the bonus.`; } else if (!milesMet) { card.description = `To qualify for the safety bonus, meet the ${settings.safetyScoreMileageThreshold} weekly miles criteria.`; card.infoText = `Drive more to unlock this bonus.`; } else if (hasSpeeding && settings.safetyBonusForfeitedOnSpeeding) { card.description = `Bonus forfeited due to ${driverData.speedingAlerts} speeding alert(s).`; card.infoText = `Needs 0 speeding alerts to unlock +${settings.safetyScoreBonus.toFixed(1)}%`; } else { card.description = 'Safety bonus not awarded this week.'; card.infoText = 'Check requirements for details.'; } break;
             case 'weeksOut': card.description = reportData.bonuses['Weeks Out'].bonus > 0 ? `Bonus for ${driverData.weeksOut} consecutive weeks out.` : `Currently at ${driverData.weeksOut} weeks out, no bonus.`; const nextWeeksOutTier = settings.weeksOutTiers.find(t => t.bonus > reportData.bonuses['Weeks Out'].bonus); card.infoText = nextWeeksOutTier ? `Stay out for ${nextWeeksOutTier.threshold} weeks for a +${nextWeeksOutTier.bonus.toFixed(1)}% bonus.` : 'Max weeks out bonus reached.'; break;
        }
        card.combinedText = card.combinedText || `${card.description} ${card.infoText}`;
    });
    
    const height = 740;
    const width = 820;

    // --- DYNAMIC TIME OFF CARD LOGIC ---
    const availableDays = reportData.availableOffDays;
    const daysTaken = driverData.offDays || 0;
    const startAfterWeeks = settings.timeOffStartAfterWeeks || 3;
    const baseDays = settings.timeOffBaseDays || 3;
    
    let excessDays;
    if (availableDays >= 0) {
        excessDays = Math.max(0, daysTaken - availableDays);
    } else {
        excessDays = daysTaken;
    }
    const remainingDays = Math.max(0, availableDays - daysTaken);
    
    const escrowDeduction = reportData.escrowDeduct;

    let timeOffCard = {
        title: 'Time Off & Escrow',
        titleIcon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
        description: '',
        value: escrowDeduction > 0 ? -escrowDeduction : escrowDeduction,
        statusBarHtml: ''
    };
    
    const timeOffCardYBase = 200 + performanceCards.length * 90;
    const timeOffCardY = timeOffCardYBase - 20;
    const statusBarY = timeOffCardYBase - 12;
    const descriptionY = timeOffCardY + 40 + 15;
    
    let dayBlocksHtml = '';
    let outlineHtml = '';
    const greenShades = ['#375D4A', '#44715A', '#52856A', '#619A7B', '#70AC8D'];
    const redShades = ['#A35B5B', '#914E4E', '#7D4141', '#6A3434', '#582A2A'];
    
    if (driverData.weeksOut < startAfterWeeks) {
        if (daysTaken > 0) {
            timeOffCard.description = `You used ${daysTaken} day(s) before meeting the ${startAfterWeeks}-week requirement. Your escrow has been deducted.`;
            const blockWidth = (370 - (daysTaken - 1) * 4) / daysTaken;
            let currentX = 320;
            for (let i = 0; i < daysTaken; i++) {
                const color = redShades[Math.min(i, redShades.length - 1)];
                dayBlocksHtml += `<g>
                    <rect x="${currentX}" y="${statusBarY}" width="${blockWidth}" height="24" fill="${color}" />
                    <text x="${currentX + blockWidth / 2}" y="${statusBarY + 12}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="#e2e8f0">${i + 1}</text>
                </g>`;
                currentX += blockWidth + 4;
            }
            const outlineWidth = (daysTaken * blockWidth) + ((daysTaken - 1) * 4);
            outlineHtml = `<rect x="318" y="${statusBarY - 2}" width="${outlineWidth + 4}" height="28" fill="none" stroke="#e2e8f0" stroke-width="1.5" />`;
        } else {
            timeOffCard.description = `You need ${startAfterWeeks} consecutive weeks out to earn ${baseDays} days off.`;
            dayBlocksHtml = `<g>
                    <rect x="320" y="${statusBarY}" width="370" height="24" fill="#334155" />
                    <text x="${320 + 370 / 2}" y="${statusBarY + 12}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="#cbd5e1">0 Days</text>
                </g>`;
        }
    } else {
        if (daysTaken === 0 && availableDays > 0) {
            // New Scenario: 0 Days Used, with available days shown
            const totalSlots = availableDays + 1; // +1 for the zero block
            const blockWidth = (370 - (totalSlots - 1) * 4) / totalSlots;
            let currentX = 320;

            // Draw the "0" block
            outlineHtml = `<rect x="${currentX - 2}" y="${statusBarY - 2}" width="${blockWidth + 4}" height="28" fill="none" stroke="#e2e8f0" stroke-width="1.5" />`;
            dayBlocksHtml += `<g>
                <rect x="${currentX}" y="${statusBarY}" width="${blockWidth}" height="24" fill="#475569" />
                <text x="${currentX + blockWidth / 2}" y="${statusBarY + 12}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="#e2e8f0">0</text>
            </g>`;
            currentX += blockWidth + 4;

            // Draw the available day blocks
            for (let i = 0; i < availableDays; i++) {
                const color = greenShades[Math.min(i, greenShades.length - 1)];
                dayBlocksHtml += `<g>
                    <rect x="${currentX}" y="${statusBarY}" width="${blockWidth}" height="24" fill="${color}" />
                    <text x="${currentX + blockWidth / 2}" y="${statusBarY + 12}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="#e2e8f0">${i + 1}</text>
                </g>`;
                currentX += blockWidth + 4;
            }
        } else {
            const totalDaySlots = availableDays + excessDays;
            const blockWidth = totalDaySlots > 0 ? (370 - (totalDaySlots - 1) * 4) / totalDaySlots : 370;
            let currentX = 320;

            for (let i = 0; i < totalDaySlots; i++) {
                let color = (i < availableDays) 
                    ? greenShades[Math.min(i, greenShades.length - 1)] 
                    : redShades[Math.min(i - availableDays, redShades.length - 1)];
                
                dayBlocksHtml += `<g>
                    <rect x="${currentX}" y="${statusBarY}" width="${blockWidth}" height="24" fill="${color}" />
                    <text x="${currentX + blockWidth / 2}" y="${statusBarY + 12}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="#e2e8f0">${i + 1}</text>
                </g>`;
                currentX += blockWidth + 4;
            }
            if (daysTaken > 0) {
                const outlineWidth = (daysTaken * blockWidth) + ((daysTaken - 1) * 4);
                outlineHtml = `<rect x="318" y="${statusBarY - 2}" width="${outlineWidth + 4}" height="28" fill="none" stroke="#e2e8f0" stroke-width="1.5" />`;
            }
        }

        if (excessDays > 0) {
            timeOffCard.description = `You used ${excessDays} excess day(s) over your ${availableDays} earned days off. Your escrow has been deducted.`;
        } else if (daysTaken > 0) {
            timeOffCard.description = `You have used ${daysTaken} of your ${availableDays} earned days off. You have ${remainingDays} day(s) remaining.`;
        } else {
            const weeksForNextDay = (settings.timeOffWeeksPerDay || 1) - ((driverData.weeksOut - startAfterWeeks) % (settings.timeOffWeeksPerDay || 1));
            timeOffCard.description = `You have ${availableDays} earned days off. Stay out for ${weeksForNextDay} more week(s) to earn another.`;
        }
    }
    timeOffCard.statusBarHtml = dayBlocksHtml + outlineHtml;

    const captureContainer = document.createElement('div');
    captureContainer.style.position = 'absolute';
    captureContainer.style.left = '-9999px';
    captureContainer.style.width = '820px';
    captureContainer.style.fontFamily = "'Inter', sans-serif";
    
    const totalBonuses = Object.values(reportData.bonuses).filter(b => b.bonus > 0).reduce((sum, b) => sum + b.bonus, 0);
    const totalPenalties = Object.values(reportData.bonuses).filter(b => b.bonus < 0).reduce((sum, b) => sum + b.bonus, 0);
    const brightGreenColor = '#74d99b', brightRedColor = '#c56060';

    const svg = `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: 'Inter', sans-serif;">
            <defs><radialGradient id="backgroundGradient" cx="50%" cy="0%" r="100%" fx="50%" fy="0%"><stop offset="0%" style="stop-color:#1e293b;" /><stop offset="100%" style="stop-color:#0f172a;" /></radialGradient></defs>
            <rect x="0" y="0" width="${width}" height="${height}" fill="url(#backgroundGradient)" />
            <text x="40" y="45" font-size="22" font-weight="600" fill="#60a5fa">${driverData.name}</text>
            <text x="${width - 40}" y="45" font-size="14" font-weight="400" fill="#94a3b8" text-anchor="end" dominant-baseline="middle">${reportDate}</text>
            <text x="37" y="110" dominant-baseline="middle" font-size="72" font-weight="900" fill="#e2b340" text-anchor="start"><tspan>${reportData.totalTpog.toFixed(1)}</tspan><tspan>%</tspan></text>
            <text x="320" y="85" dominant-baseline="middle" font-size="15" font-weight="600" fill="#e2e8f0">Base: +${formatNumber(settings.baseRate)}%</text>
            <text x="320" y="105" dominant-baseline="middle" font-size="15" font-weight="600" fill="${brightGreenColor}">Bonuses: +${formatNumber(totalBonuses)}%</text>
            <text x="320" y="125" dominant-baseline="middle" font-size="15" font-weight="600" fill="${brightRedColor}">Penalties: ${formatNumber(totalPenalties)}%</text>
            
            ${performanceCards.map((card, index) => {
                const y_base = 200 + index * 90;
                const card_height = 40;
                const card_y = y_base - card_height / 2;
                const valueDisplayColor = card.value > 0 ? brightGreenColor : card.value < 0 ? brightRedColor : '#e2e8f0';
                
                const barHtml = card.barTiers ? (() => { let activeTierValue = card.value; if (card.type === 'tenure') { activeTierValue = settings.tenureMilestones.filter(m => driverData.tenure >= m.threshold).reduce((sum, m) => sum + m.bonus, 0); } const closestTier = card.barTiers.reduce((prev, curr) => (Math.abs(curr - activeTierValue) < Math.abs(prev - activeTierValue) ? curr : prev)); const numTiers = card.barTiers.length; let segmentWidth = 370; if (numTiers > 1) { segmentWidth = (370 - (4 * (numTiers - 1))) / numTiers; } let currentX = 320; let tiersHtml = ''; card.barTiers.forEach(tier => { const isActive = tier === closestTier; tiersHtml += `<g>${isActive ? `<rect x="${currentX - 2}" y="${y_base - 14}" width="${segmentWidth + 4}" height="28" fill="none" stroke="#e2e8f0" stroke-width="1.5" />` : ''}<rect x="${currentX}" y="${y_base - 12}" width="${segmentWidth}" height="24" fill="${getTierBgColor(tier)}" /><text x="${currentX + segmentWidth / 2}" y="${y_base}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="${(tier === 0) ? '#cbd5e1' : '#e2e8f0'}">${tier > 0 ? '+' : ''}${formatNumber(tier)}%</text></g>`; currentX += segmentWidth + 4; }); return tiersHtml; })() : '';
                context.font = '400 10px Inter'; const words = card.combinedText.split(' '); let currentLine = words[0]; const lines = []; for (let i = 1; i < words.length; i++) { const testLine = `${currentLine} ${words[i]}`; if (context.measureText(testLine).width > (width - 80)) { lines.push(currentLine); currentLine = words[i]; } else { currentLine = testLine; } } lines.push(currentLine); const descriptionHtml = lines.map((line, i) => `<tspan x="60" dy="${i === 0 ? 0 : '1.4em'}">${line}</tspan>`).join('');

                return `<g><rect x="40" y="${card_y}" width="${width - 80}" height="${card_height}" fill="#1e293b" fill-opacity="0.5" /><g transform="translate(55, ${y_base})"><path d="${card.titleIcon}" stroke="#94a3b8" stroke-width="1.5" fill="none" transform="scale(0.8) translate(0, -14)"/><text x="26" y="0" dominant-baseline="middle" font-size="15" font-weight="600" fill="#ffffff">${card.title}</text></g>${barHtml}<text x="${width - 55}" y="${y_base}" dominant-baseline="middle" font-size="18" font-weight="700" fill="${valueDisplayColor}" text-anchor="end">${card.value > 0 ? '+' : ''}${formatNumber(card.value)}%</text><text y="${card_y + card_height + 15}" font-size="10" fill="#60a5fa">${descriptionHtml}</text></g>`;
            }).join('')}

            <g>
                <rect x="40" y="${timeOffCardY}" width="${width - 80}" height="40" fill="#1e293b" fill-opacity="0.5" />
                <g transform="translate(55, ${timeOffCardYBase})">
                    <path d="${timeOffCard.titleIcon}" stroke="#94a3b8" stroke-width="1.5" fill="none" transform="scale(0.8) translate(0, -14)"/>
                    <text x="26" y="0" dominant-baseline="middle" font-size="15" font-weight="600" fill="#ffffff">${timeOffCard.title}</text>
                </g>
                ${timeOffCard.statusBarHtml}
                <text x="${width - 55}" y="${timeOffCardYBase}" dominant-baseline="middle" font-size="18" font-weight="700" fill="${timeOffCard.value < 0 ? brightRedColor : '#e2e8f0'}" text-anchor="end">${formatCurrency(timeOffCard.value)}</text>
                <text y="${descriptionY}" font-size="10" fill="#60a5fa">
                    <tspan x="60" dy="0">${timeOffCard.description}</tspan>
                </text>
            </g>
        </svg>
    `;
    
    captureContainer.innerHTML = svg;
    document.body.appendChild(captureContainer);
    html2canvas(captureContainer, { backgroundColor: null, scale: 2, useCORS: true }).then(canvas => {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `Driver_Scorecard_${driverData.name.replace(/\s+/g, '_')}.png`;
        a.click();
        document.body.removeChild(captureContainer);
    }).catch(err => {
        console.error("html2canvas failed:", err);
        if (document.body.contains(captureContainer)) {
            document.body.removeChild(captureContainer);
        }
    });
}

/**
 * Opens and populates the manual report/edit panel.
 * @param {number|null} driverId The ID of the driver to edit, or null for a new report.
 * @param {Object} state The application state.
 */
export function openEditPanel(driverId, state) {
    const { drivers, availableContractTypes, allDrivers, settings, driversForDate, overriddenDistances } = state;
    const isNew = driverId === null;
    const driver = isNew ? { name: '', dispatcher: '', team: '', franchise: '', contract_type: '', weeksOut: 0, milesWeek: 0, samsaraDistance: 0, tenure: 0, gross: 0, rpm: 0, estimatedNet: 0, safetyScore: 0, speedingAlerts: 0, speedingPercentile: 0, mpg: 0, mpgPercentile: 0 } : drivers.find(d => d.id == driverId);
    if (!driver) return;
    document.getElementById('edit-driver-name').textContent = isNew ? "New Driver" : driver.name;

    const reportData = isNew ? { availableOffDays: 0, escrowDeduct: 0 } : getDriverReportData(driver, settings);

    const payDate = isNew ? '' : driver.pay_date.split('T')[0];
    const overrideKey = `${driverId}_${payDate}`;
    const activeOverride = overriddenDistances[overrideKey];
    const distanceKey = activeOverride || 'milesWeek';
    const distanceValue = driver[distanceKey];
    const originalMpg = parseFloat(driver.mpg).toFixed(2);
    const originalMpgPercentile = Math.round(parseFloat(driver.mpgPercentile));

    let formHtml = '';
    if (isNew) {
        formHtml = `
            <div class="relative">
                <label class="block text-sm font-medium text-slate-400 mb-1">Driver Name</label>
                <input type="text" id="edit-name" class="edit-input" value="" autocomplete="off">
                <div id="driver-suggestions" class="hidden absolute z-10 w-full bg-slate-700 border border-slate-600 rounded-md mt-1 max-h-48 overflow-y-auto"></div>
            </div>`;
    }
    
    const fieldsToExclude = ['id', 'name', 'totalTpog', 'actions', 'contract_type', 'dispatcher', 'team', 'franchise', 'company', 'gross', 'rpm', 'estimatedNet', 'bonuses', 'penalties', 'speeding_over11mph', 'speeding_over16mph', 'milesWeek', 'samsaraDistance', 'availableOffDays', 'escrowDeduct', 'offDays'];

    const orderedKeys = [
        'tenure',
        'safetyScore',
        'speedingAlerts',
        'speedingPercentile',
        distanceKey,
        'mpg',
        'mpgPercentile',
        'weeksOut'
    ];

    const createFieldHTML = (key, val) => {
        const config = columnConfig[key] || { title: 'Distance', type: 'number' };
        const inputType = (config.type === 'number' || config.type === 'percent') ? 'number' : 'text';
        return `<div><label class="block text-sm font-medium text-slate-400 mb-1">${config.title}</label><input type="${inputType}" id="edit-${key}" class="edit-input" value="${val}"></div>`;
    };

    let formFieldsHtml = orderedKeys.map(key => {
        let value = isNew ? '0' : driver[key];
        if (key === 'mpg') value = originalMpg;
        if (key === 'mpgPercentile') value = originalMpgPercentile;
        if (key === distanceKey) value = distanceValue;
        return createFieldHTML(key, value);
    }).join('');

    const timeOffFieldsHtml = `
        <div><label class="block text-sm font-medium text-slate-400 mb-1">Available Days Off</label><input type="number" id="edit-availableOffDays" class="edit-input" value="${reportData.availableOffDays}"></div>
        <div><label class="block text-sm font-medium text-slate-400 mb-1">Days Taken</label><input type="number" id="edit-offDays" class="edit-input" value="${driver.offDays || 0}"></div>
        <div><label class="block text-sm font-medium text-slate-400 mb-1">Escrow Deduct</label><input type="number" id="edit-escrowDeduct" class="edit-input" value="${reportData.escrowDeduct}"></div>
    `;

    editContent.innerHTML = `<div class="grid grid-cols-1 gap-4">${formHtml}${formFieldsHtml}${timeOffFieldsHtml}</div>`;
    editPanel.classList.add('open');
    editOverlay.classList.remove('hidden');

    const mpgInput = document.getElementById('edit-mpg');
    const mpgPercentileInput = document.getElementById('edit-mpgPercentile');
    const speedingInput = document.getElementById('edit-speedingAlerts');
    const speedingPercentileInput = document.getElementById('edit-speedingPercentile');

    if (mpgInput && mpgPercentileInput) {
        mpgInput.addEventListener('input', () => {
            const mpg = parseFloat(mpgInput.value);
            const percentile = calculateMpgPercentile(mpg, driversForDate);
            mpgPercentileInput.value = percentile;
        });
    }

    if (speedingInput && speedingPercentileInput) {
        speedingInput.addEventListener('input', () => {
            const alerts = parseInt(speedingInput.value, 10);
            const percentile = calculateSpeedingPercentile(alerts, driversForDate, settings);
            speedingPercentileInput.value = percentile;
        });
    }

    if (isNew) {
        const nameInput = document.getElementById('edit-name');
        const suggestionsContainer = document.getElementById('driver-suggestions');
        
        nameInput.addEventListener('input', () => {
            const query = nameInput.value.toLowerCase();
            suggestionsContainer.innerHTML = '';
            if (query.length === 0) { suggestionsContainer.classList.add('hidden'); return; }
            const uniqueNames = [...new Set(allDrivers.map(d => d.name))];
            const filteredDrivers = uniqueNames.filter(name => name.toLowerCase().startsWith(query));

            if (filteredDrivers.length > 0) {
                suggestionsContainer.classList.remove('hidden');
                filteredDrivers.forEach(name => {
                    const suggestionItem = document.createElement('div');
                    suggestionItem.textContent = name;
                    suggestionItem.className = 'p-2 text-sm text-slate-200 hover:bg-slate-600 cursor-pointer';
                    suggestionItem.addEventListener('click', () => {
                        nameInput.value = name;
                        suggestionsContainer.classList.add('hidden');
                    });
                    suggestionsContainer.appendChild(suggestionItem);
                });
            } else {
                suggestionsContainer.classList.add('hidden');
            }
        });
        
        document.addEventListener('click', (event) => {
            if (!nameInput.contains(event.target) && !suggestionsContainer.contains(event.target)) {
                suggestionsContainer.classList.add('hidden');
            }
        }, true);
    }
}

/** Closes the manual report/edit panel. */
export function closeEditPanel() {
    editPanel.classList.remove('open');
    editOverlay.classList.add('hidden');
}

export function openActivityHistoryModal(driver, mileageData, settings, daysTakenHistory, dispatcherOverrides) {
    const modal = document.getElementById('activity-history-modal');
    const content = document.getElementById('activity-history-content');
    document.getElementById('activity-history-driver-name').textContent = driver.name;

    content.innerHTML = '<p class="text-slate-500 text-center py-10">Loading history...</p>';
    modal.classList.remove('hidden');

    const driverMileageRecords = mileageData.filter(m => m.driver_name === driver.name);
    const driverChangelog = daysTakenHistory.filter(h => h.driver_name === driver.name);

    if (driverMileageRecords.length === 0 && driverChangelog.length === 0) {
        content.innerHTML = '<p class="text-slate-500 text-center py-10">No activity history found.</p>';
        return;
    }

    const allRecordDates = [
        ...driverMileageRecords.map(d => new Date(d.date)),
        ...driverChangelog.map(d => new Date(d.date))
    ];

    const driverFirstAppearance = new Date(Math.min(...allRecordDates));

    const formatDate = (date) => date.toISOString().split('T')[0];
    let historyHtml = '';

    const driverMileageMap = new Map(
        driverMileageRecords.map(m => [m.date, m.movement || 0])
    );

    const WEEKS_TO_SHOW_MAX = 12;

    for (let i = 0; i < WEEKS_TO_SHOW_MAX; i++) {
        const payDate = new Date(driver.pay_date);
    
        const dayOfWeek = payDate.getUTCDay();
        const daysToSubtract = (dayOfWeek + 6) % 7;
        const baseMonday = new Date(payDate);
        baseMonday.setUTCDate(payDate.getUTCDate() - daysToSubtract);
    
        const monday = new Date(baseMonday);
        monday.setUTCDate(baseMonday.getUTCDate() - (i * 7));

        if (driverFirstAppearance && monday < driverFirstAppearance) {
            break;
        }

        const tuesday = new Date(monday);
        tuesday.setUTCDate(monday.getUTCDate() - 6);

        let weeklyActivityData = [];
        const dayLabels = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday'];
        const dayShortLabels = ['T', 'W', 'T', 'F', 'S', 'S', 'M'];

        for (let j = 0; j < 7; j++) {
            const currentDay = new Date(tuesday);
            currentDay.setUTCDate(tuesday.getUTCDate() + j);
            const dayString = formatDate(currentDay);
            const mileage = driverMileageMap.get(dayString) || 0;
            const formattedDate = `${dayLabels[j]}, ${(currentDay.getUTCMonth() + 1).toString().padStart(2, '0')}.${currentDay.getUTCDate().toString().padStart(2, '0')}`;

            const overrideKey = `${driver.name}_${dayString}`;
            const overrideStatus = dispatcherOverrides[overrideKey];
            const isOverridden = !!dispatcherOverrides[overrideKey];

            // Get system status
            const statusesForDay = driverChangelog
                .filter(log => new Date(log.date).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) === currentDay.toLocaleDateString('en-US', { timeZone: 'America/Chicago' }))
                .map(log => log.activity_status);
            const uniqueStatuses = [...new Set(statusesForDay)];
            const systemStatusText = uniqueStatuses.length > 0 ? uniqueStatuses.join(', ') : 'No Status Change';
            
            let finalStatus = systemStatusText;
            let tooltipStatus = systemStatusText;
            let isChanged = false;

            if (isOverridden) {
                if (overrideStatus !== 'CORRECT') {
                    finalStatus = overrideStatus;
                    tooltipStatus = `${overrideStatus} (Dispatch Override)`;
                    isChanged = true;
                }
            }

            weeklyActivityData.push({
                day: dayShortLabels[j],
                mileage: mileage,
                fullDate: formattedDate,
                statuses: finalStatus,
                tooltipStatus: tooltipStatus,
                isOverridden: isOverridden,
                isChanged: isChanged
            });
        }
        
        let weekHtml = `<div class="mb-4 p-3 bg-slate-800 rounded-lg">
                            <p class="text-sm font-semibold text-slate-300 mb-2">Week of ${formatDate(tuesday)} to ${formatDate(monday)}</p>
                            <div class="flex items-center justify-center gap-1">`;

                            weeklyActivityData.forEach(activity => {
                                let colorClass = 'activity-red';
                                const statuses = (activity.statuses || '').toUpperCase();

                                switch (settings.weeksOutMethod) {
                                    case 'daysOff':
                                        if (statuses.includes('DAY_OFF')) {
                                            colorClass = 'activity-red';
                                        } else if (statuses.includes('WITHOUT_LOAD')) {
                                            colorClass = 'activity-orange';
                                        } else if (statuses.includes('ACTIVE')) {
                                            colorClass = 'activity-green';
                                        } else {
                                             colorClass = activity.mileage > 0 ? 'activity-green' : 'activity-red';
                                        }
                                        break;
                                    case 'daily':
                                        colorClass = activity.mileage >= (settings.weeksOutMileageThreshold || 0) ? 'activity-green' : 'activity-red';
                                        break;
                                    case 'weekly':
                                    default:
                                        colorClass = activity.mileage > 0 ? 'activity-green' : 'activity-red';
                                        break;
                                }

                                const miles = activity.mileage.toFixed(0);
                                const mileLabel = miles === "1" ? "mile" : "mi";
                                let tooltipText = `${activity.fullDate} - ${miles} ${mileLabel}. Status: ${activity.statuses}`;
                                if (activity.isChanged) {
                                    tooltipText = `${activity.fullDate} - ${miles} ${mileLabel}. Status: ${activity.tooltipStatus}`;
                                }

                                const overrideClass = activity.isChanged ? 'dispatch-override' : '';

                                weekHtml += `<div class="tooltip-container" data-tooltip="${tooltipText}">
                                                <div class="weekly-activity-block ${colorClass} ${overrideClass}">${activity.day}</div>
                                            </div>`;
                            });

        weekHtml += '</div></div>';
        historyHtml += weekHtml;
    }

    content.innerHTML = historyHtml || '<p class="text-slate-500 text-center py-10">No historical activity found.</p>';
}

export function closeActivityHistoryModal() {
    document.getElementById('activity-history-modal').classList.add('hidden');
}

export const filterableColumns = ['dispatcher', 'franchise', 'contract_type', 'name'];

export const filterOperators = {
    'string': [
        { value: 'contains', text: 'contains' },
        { value: 'does_not_contain', text: 'does not contain' },
        { value: 'is', text: 'is' },
        { value: 'is_not', text: 'is not' },
        { value: 'starts_with', text: 'starts with' },
        { value: 'ends_with', text: 'ends with' },
        { value: 'is_any_of', text: 'is any of' },
        { value: 'is_not_any_of', text: 'is not any of' },
        { value: 'is_empty', text: 'is empty' },
        { value: 'is_not_empty', text: 'is not empty' },
    ]
};

const getFilterableColumnOptions = () => {
    return filterableColumns.map(key => `<option value="${key}">${columnConfig[key].title}</option>`).join('');
};

const getOperatorOptions = (type) => {
    return filterOperators[type].map(op => `<option value="${op.value}">${op.text}</option>`).join('');
};

const getFilterValueFieldHTML = (column, data, operator) => {
    const selectColumns = ['dispatcher', 'franchise', 'team', 'contract_type'];
    const selectOperators = ['is', 'is_not', 'is_any_of', 'is_not_any_of'];

    if (selectColumns.includes(column) && selectOperators.includes(operator)) {
        const isMulti = operator === 'is_any_of' || operator === 'is_not_any_of';
        const uniqueValues = [...new Set(data.map(d => d[column]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
        const options = uniqueValues.map(value => `<option value="${value}">${value}</option>`).join('');
        return `<select class="filter-value text-slate-200 bg-slate-700 rounded-md py-1 px-2 w-full text-sm" ${isMulti ? 'multiple' : ''}>${options}</select>`;
    }

    // Fallback to text input for other columns/operators
    let placeholder = 'Filter value';
    if (operator === 'is_any_of' || operator === 'is_not_any_of') {
        placeholder = 'e.g. value1, value2';
    }
    return `<input type="text" class="filter-value text-slate-200 bg-slate-700 rounded-md py-1 px-2 w-full text-sm" placeholder="${placeholder}">`;
};

export function updateFilterValueField(filterRow, data) {
    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const column = columnSelect.value;
    const operator = operatorSelect.value;
    const valueContainer = filterRow.querySelector('.filter-value-container');

    if (operator === 'is_empty' || operator === 'is_not_empty') {
        valueContainer.innerHTML = `<input type="text" class="filter-value" style="display: none;">`;
    } else {
        valueContainer.innerHTML = getFilterValueFieldHTML(column, data, operator);
    }
}

export function addFilterRow(container, allDrivers) {
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row grid grid-cols-[auto_auto_1fr_auto] gap-2 items-center text-sm p-2 border border-slate-700 rounded-md';
    const defaultOperator = filterOperators.string[0].value;
    filterRow.innerHTML = `
        <div>
            <select class="filter-column text-slate-200 bg-slate-700 rounded-md py-1 px-2 w-full text-sm">
                ${getFilterableColumnOptions()}
            </select>
        </div>
        <div>
            <select class="filter-operator text-slate-200 bg-slate-700 rounded-md py-1 px-2 w-full text-sm">
                ${getOperatorOptions('string')}
            </select>
        </div>
        <div class="filter-value-container">
            ${getFilterValueFieldHTML(filterableColumns[0], allDrivers, defaultOperator)}
        </div>
        <button type="button" class="remove-filter-btn text-slate-500 hover:text-red-500 p-1 rounded-full transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
    `;
    container.appendChild(filterRow);
}

/**
 * Populates the column visibility dropdown filter.
 * @param {Array<string>} columns An array of all available column keys.
 * @param {Object} pinnedColumns The pinned columns state.
 * @param {Function} changeCallback The function to call when the filter changes.
 */
export function populateColumnToggle(columns, pinnedColumns, changeCallback, initialVisibleKeys) {
    const columnToggleOptions = document.getElementById('column-toggle-options');
    columnToggleOptions.innerHTML = '';

    const getVisibleColumns = () => {
        return [...document.querySelectorAll('.column-toggle-checkbox:checked')].map(cb => cb.value);
    };

    const createButton = (text, onClick) => {
        const div = document.createElement('div');
        div.className = 'p-2 border-b border-slate-600 hover:bg-slate-700 cursor-pointer text-blue-400 font-semibold';
        div.textContent = text;
        div.onclick = () => {
            onClick();
            changeCallback(getVisibleColumns());
        };
        columnToggleOptions.appendChild(div);
    };

    createButton('Select All', () => {
        document.querySelectorAll('.column-toggle-checkbox').forEach(cb => cb.checked = true);
    });
    createButton('Deselect All', () => {
        document.querySelectorAll('.column-toggle-checkbox').forEach(cb => {
            if (!cb.disabled) {
               cb.checked = false;
            }
        });
    });

    columns.forEach(key => {
        const config = columnConfig[key];
        const isPinned = pinnedColumns.left.includes(key) || pinnedColumns.right.includes(key);
        const isEssential = ['name', 'totalTpog', 'actions'].includes(key);
        const isDisabled = isPinned && isEssential;
        const isVisible = initialVisibleKeys.includes(key);

        const optionDiv = document.createElement('div');
        optionDiv.className = 'p-2 hover:bg-slate-700';
        optionDiv.innerHTML = `<label class="flex items-center space-x-2 ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}">
            <input type="checkbox" value="${key}" class="column-toggle-checkbox h-4 w-4 rounded border-slate-500 text-blue-600 focus:ring-blue-500" ${isVisible ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
            <span class="text-slate-200 ${isDisabled ? 'text-slate-500' : ''}">${config.title}</span>
        </label>`;
        columnToggleOptions.appendChild(optionDiv);
    });

    columnToggleOptions.addEventListener('change', (e) => {
        if (e.target.classList.contains('column-toggle-checkbox')) {
            changeCallback(getVisibleColumns());
        }
    });
}

/** Shows a short-lived toast notification. */
export function showToast() {
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

/** Updates the loading overlay and progress bar. */
export function updateLoadingProgress(width, hide = false) {
    if (progressBar) progressBar.style.width = width;
    if (hide && loadingOverlay) {
        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
        }, 500);
    }
}

/**
 * Renders the safety history table and chart.
 * @param {Array<Object>} data The safety data to render.
 */
function renderSafetyTable(data) {
    const container = document.getElementById('safety-content');
    if (!data || data.length === 0) {
        container.innerHTML = `<p class="text-slate-500 text-center py-10">No safety history found for this driver.</p>`;
        return;
    }

    const tableHtml = `
        <div class="history-table-wrapper">
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Week</th>
                        <th>Safety Score</th>
                        <th>Samsara Distance</th>
                        <th>Light Speeding</th>
                        <th>Moderate Speeding</th>
                        <th>Heavy Speeding</th>
                        <th>Severe Speeding</th>
                        <th>Max Speed</th>
                        <th>Harsh Brake</th>
                        <th>Harsh Turn</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map(row => {
                        // Create a new Date object from the timestamp string
                        const date = new Date(row.date);
                        // Format the date to MM/DD/YYYY
                        const formattedDate = date.toLocaleDateString('en-US', {
                            month: '2-digit',
                            day: '2-digit',
                            year: 'numeric',
                            timeZone: 'UTC' // Use UTC to avoid timezone shifts
                        });
                        const distance = Math.round(parseFloat(row.totalDistance) || 0);
                        const maxSpeed = Math.round(parseFloat(row.maxSpeed) || 0);
                        return `
                            <tr>
                                <td>${formattedDate}</td>
                                <td>${row.safetyScore}%</td>
                                <td>${distance} mi</td>
                                <td>${row.lightSpeeding}</td>
                                <td>${row.moderateSpeeding}</td>
                                <td>${row.heavySpeeding}</td>
                                <td>${row.severeSpeeding}</td>
                                <td>${maxSpeed} mph</td>
                                <td>${row.harshBrake}</td>
                                <td>${row.harshTurn}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div class="chart-container">
            <canvas id="safety-history-chart"></canvas>
        </div>`;
    container.innerHTML = tableHtml;
    renderSafetyChart(data);
}


/**
 * Renders the changelog table for a specific driver.
 * @param {Array<Object>} driverLogs The filtered changelog data for one driver.
 * @param {Array<Object>} mileageData All historical mileage records.
 * @param {string} driverName The name of the driver being viewed.
 */
function renderChangelogTable(driverLogs, mileageData, driverName) {
    const container = document.getElementById('changelog-content');

    if (!driverLogs || driverLogs.length === 0) {
        container.innerHTML = `<p class="text-slate-500 text-center py-10">No status changes found for this driver.</p>`;
        return;
    }

    // Create a lookup map for the driver's daily mileage for efficient access
    const driverMileageMap = new Map(
        mileageData
            .filter(m => m.driver_name === driverName)
            .map(m => [m.date, m.movement || 0])
    );

    const groupedByDate = driverLogs.reduce((acc, log) => {
        const dateKey = new Date(log.date).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
        if (!acc[dateKey]) {
            // Initialize with daily mileage from the ProLogs data
            const yyyyMMdd = new Date(log.date).toISOString().split('T')[0];
            const dailyMiles = driverMileageMap.get(yyyyMMdd) || 0;
            acc[dateKey] = { logs: [], totalMiles: dailyMiles };
        }
        acc[dateKey].logs.push(log);
        return acc;
    }, {});

    const sortedDates = Object.keys(groupedByDate).sort((a, b) => new Date(b) - new Date(a));

    let accordionHtml = '<div class="space-y-2">';
    sortedDates.forEach((date, index) => {
        const group = groupedByDate[date];
        const changeCount = group.logs.length;
        const totalMiles = group.totalMiles.toFixed(0); // This is now the unique daily total
        const contentId = `changelog-content-${index}`;

        accordionHtml += `
            <div class="bg-slate-800 rounded-lg border border-slate-700">
                <div class="changelog-group-header p-3 flex justify-between items-center cursor-pointer">
                    <div class="flex items-center gap-4">
                        <svg class="changelog-chevron w-5 h-5 text-slate-500 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        <span class="font-semibold text-slate-200">${date}</span>
                    </div>
                    <div class="text-sm text-slate-400">
                        <span>${changeCount} ${changeCount === 1 ? 'change' : 'changes'}</span>
                        <span class="mx-2">|</span>
                        <span>${totalMiles} miles driven</span>
                    </div>
                </div>
                <div id="${contentId}" class="changelog-group-content hidden border-t border-slate-700 p-2">
                    <table class="history-table">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Driver Status</th>
                                <th>Days in Status</th>
                                <th>Days Since DO</th>
                                <th>Truck ID</th>
                                <th>Truck Status</th>
                                <th>Truck Days in Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${group.logs.sort((a, b) => new Date(b.date) - new Date(a.date)).map(row => {
                                const timestamp = new Date(row.date).toLocaleTimeString('en-US', {
                                    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chicago'
                                });
                                return `
                                    <tr>
                                        <td>${timestamp}</td>
                                        <td>${row.driver_assignment_status || '-'}</td>
                                        <td>${row.driver_days_in_status || '-'}</td>
                                        <td>${row.days_since_do || '-'}</td>
                                        <td>${row.truck_id || '-'}</td>
                                        <td>${row.truck_operational_status || '-'}</td>
                                        <td>${row.truck_days_in_status || '-'}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });
    accordionHtml += '</div>';

    container.innerHTML = accordionHtml;
}

/**
 * Renders the fuel history table and chart into its container.
 * @param {Array<Object>} data The COMBINED fuel and MPG data to render.
 */
function renderFuelTable(data, unmatchedPurchases = [], isGrouped = false) {
    const container = document.getElementById('fuel-content');
    if ((!data || data.length === 0) && unmatchedPurchases.length === 0) {
        container.innerHTML = `<p class="text-slate-500 text-center py-10">No MPG history found for this driver.</p>`;
        return;
    }

    if (isGrouped) {
        // --- GROUPED VIEW LOGIC ---
        const groupedData = data.reduce((acc, row) => {
            const date = new Date(row.hour_timestamp).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
            if (!acc[date]) {
                acc[date] = {
                    date: date,
                    odometerMovement: 0,
                    fuelDecrease: 0,
                    fuelUps: 0,
                    gallons: 0,
                    fuelSpent: 0 // Initialize correct field
                };
            }
            const group = acc[date];
            const fuelMovement = parseFloat(row.fuel_movement) || 0;

            group.odometerMovement += parseFloat(row.odometer_movement) || 0;
            
            // Only aggregate fuel spent when the fuel level is decreasing
            if (fuelMovement < 0) {
                group.fuelSpent += parseFloat(row.fuel_spent) || 0;
                group.fuelDecrease += fuelMovement;
            }

            if (row.fuelUp_Quantity) {
                group.fuelUps++;
                group.gallons += parseFloat(row.fuelUp_Quantity) || 0;
            }
            return acc;
        }, {});

        const sortedGroupedData = Object.values(groupedData).map(day => {
            // Calculate MPG for the day using the correct property
            day.mpg = day.fuelSpent > 0 ? day.odometerMovement / day.fuelSpent : 0;
            return day;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));


        const tableHtml = `
            <div class="history-table-wrapper">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Odometer Movement</th>
                            <th>MPG</th>
                            <th>Fuel-Ups</th>
                            <th>Gallons Purchased</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedGroupedData.map(day => `
                            <tr>
                                <td>${day.date}</td>
                                <td>${day.odometerMovement.toFixed(0)} mi</td>
                                <td>${day.mpg.toFixed(2)}</td>
                                <td>${day.fuelUps}</td>
                                <td>${day.gallons.toFixed(2)} gal</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="chart-container">
                <canvas id="grouped-fuel-history-chart"></canvas>
            </div>`;
        container.innerHTML = tableHtml;
        renderGroupedHistoryChart(sortedGroupedData);

    } else {
        // --- DETAILED (CURRENT) VIEW LOGIC ---
        const formatValue = (value, options = {}) => {
            const num = parseFloat(value);
            if (isNaN(num)) return '-';
            const { prefix = '', suffix = '', decimals = 0 } = options;
            return `${prefix}${num.toFixed(decimals)}${suffix}`;
        };
        const formatHour = (timestamp) => {
            if (!timestamp) return '-';
            const date = new Date(timestamp);
            const options = { timeZone: 'America/Chicago', year: '2-digit', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: true };
            return new Intl.DateTimeFormat('en-US', options).format(date).replace('am', 'AM').replace('pm', 'PM');
        };
        const formatFuelUpTime = (timestamp) => {
            if (!timestamp) return '-';
            const date = new Date(timestamp);
            const options = { timeZone: 'America/Chicago', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true };
            return new Intl.DateTimeFormat('en-US', options).format(date).replace('am', 'AM').replace('pm', 'PM');
        };

        const allRowsData = [
            ...data.map(row => ({ ...row, type: 'hourly', sortDate: new Date(row.hour_timestamp) })),
            ...unmatchedPurchases.map(purchase => ({ ...purchase, type: 'unmatched', sortDate: new Date(purchase.date) }))
        ];
        allRowsData.sort((a, b) => b.sortDate - a.sortDate);

        const tableRowsHtml = allRowsData.map(row => {
            if (row.type === 'hourly') {
                const hourDateTime = formatHour(row.hour_timestamp);
                const fuelUpQuantity = row.fuelUp_Quantity ? formatValue(row.fuelUp_Quantity, { decimals: 2 }) : '-';
                const fuelUpAmount = row.fuelUp_Amount ? formatValue(row.fuelUp_Amount, { prefix: '$', decimals: 2 }) : '-';
                let fuelUpDateCell;
                const fuelMovement = parseFloat(row.fuel_movement);

                if (fuelMovement > 0 && !row.fuelUp_Date) {
                    fuelUpDateCell = `<td style="color: #f87171; font-weight: 600;">MISSING RECORD OR FAULTY GAUGE</td>`;
                } else {
                    const fuelUpDateTime = formatFuelUpTime(row.fuelUp_Date);
                    fuelUpDateCell = `<td style="color: #4ade80;">${fuelUpDateTime}</td>`;
                }

                return `
                    <tr data-timestamp="${row.hour_timestamp}" style="cursor: pointer;">
                        <td>${hourDateTime}</td>
                        <td>${row.odometer || '-'}</td>
                        <td>${formatValue(row.odometer_movement, { prefix: '+ ', suffix: ' mi' })}</td>
                        <td>${formatValue(row.fuel_level, { suffix: '%', decimals: 0 })}</td>
                        <td>${formatValue(row.fuel_movement, { suffix: '%', decimals: 0 })}</td>
                        <td>${formatValue(row.fuel_spent, { decimals: 2 })}</td>
                        ${fuelUpDateCell}
                        <td style="color: #4ade80;">${fuelUpQuantity}</td>
                        <td style="color: #4ade80;">${fuelUpAmount}</td>
                        <td>${row.truck_unit_id || '-'}</td>
                    </tr>`;
            } else {
                const fuelUpDateTime = formatFuelUpTime(row.date);
                const fuelUpQuantity = formatValue(row.quantity, { decimals: 2 });
                const fuelUpAmount = formatValue(row.amount, { prefix: '$', decimals: 2 });
                return `
                    <tr class="bg-red-900/20">
                        <td>-</td>
                        <td>-</td>
                        <td colspan="4" style="color: #fca5a5; font-weight: 600;">NO GAUGE DATA AVAILABLE FOR THIS PURCHASE</td>
                        <td style="color: #4ade80;">${fuelUpDateTime}</td>
                        <td style="color: #4ade80;">${fuelUpQuantity}</td>
                        <td style="color: #4ade80;">${fuelUpAmount}</td>
                        <td>-</td>
                    </tr>`;
            }
        }).join('');

        const tableHtml = `
            <div class="history-table-wrapper">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Hour</th>
                            <th>Odometer</th>
                            <th>Odometer Movement</th>
                            <th>Fuel Level</th>
                            <th>Fuel Movement</th>
                            <th>Fuel Spent (gal)</th>
                            <th>FuelUp Date/Time</th>
                            <th>Quantity (gal)</th>
                            <th>Amount ($)</th>
                            <th>Truck</th>
                        </tr>
                    </thead>
                    <tbody>${tableRowsHtml}</tbody>
                </table>
            </div>
            <div class="chart-container">
                <canvas id="fuel-history-chart"></canvas>
            </div>`;

        container.innerHTML = tableHtml;
        renderHistoryChart(data);
    }
}

/**
 * Renders the historical data chart for fuel and odometer movement.
 * @param {Array<Object>} fuelData The historical fuel data.
 */
function renderHistoryChart(fuelData) {
    const ctx = document.getElementById('fuel-history-chart');
    if (!ctx) return;
    if (historyChart) historyChart.destroy();

    const reversedData = [...fuelData].reverse();

    const odometerMovementData = reversedData.map(d => ({
        x: new Date(d.hour_timestamp).getTime(),
        y: parseFloat(d.odometer_movement)
    }));
    const fuelLevelData = reversedData.map(d => ({
        x: new Date(d.hour_timestamp).getTime(),
        y: parseFloat(d.fuel_level)
    }));

    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                { label: 'Odometer Movement (mi)', data: odometerMovementData, borderColor: '#3b82f6', yAxisID: 'yOdometer', tension: 0.1, pointRadius: 2, borderWidth: 2 },
                { label: 'Fuel Level (%)', data: fuelLevelData, borderColor: '#10b981', yAxisID: 'yFuel', tension: 0.1, pointRadius: 2, borderWidth: 2 }
            ]
        },
        plugins: [verticalLinePlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            onClick: (event) => {
                const points = historyChart.getElementsAtEventForMode(event, 'index', { intersect: false }, true);
                if (points.length > 0) {
                    const dataIndex = points[0].index;
                    const timestamp = reversedData[dataIndex].hour_timestamp;
                    document.querySelectorAll('#fuel-content .history-table tbody tr').forEach(row => row.classList.remove('row-highlight'));
                    const row = document.querySelector(`#fuel-content tr[data-timestamp="${timestamp}"]`);
                    if (row) {
                        row.classList.add('row-highlight');
                        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        displayFormats: {
                            day: 'MM/dd'
                        }
                    },
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                yOdometer: { type: 'linear', position: 'left', title: { display: true, text: 'Odometer Movement (mi)', color: '#3b82f6' }, ticks: { color: '#94a3b8' }, grid: { drawOnChartArea: false } },
                yFuel: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 100,
                    title: { display: true, text: 'Fuel Level (%)', color: '#10b981' },
                    ticks: { color: '#94a3b8', callback: value => `${value}%` },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            },
            plugins: {
                legend: { position: 'bottom', labels: { color: '#e2e8f0', usePointStyle: false, boxWidth: 25, boxHeight: 2, padding: 20 } },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const timestamp = context[0].parsed.x;
                            return new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/Chicago' });
                        }
                    }
                }
            }
        }
    });
}


/**
 * Renders the daily summary chart for grouped fuel history.
 * @param {Array<Object>} groupedData The array of daily summary objects.
 */
function renderGroupedHistoryChart(groupedData) {
    const ctx = document.getElementById('grouped-fuel-history-chart');
    if (!ctx) return;
    if (groupedHistoryChart) groupedHistoryChart.destroy();

    const reversedData = [...groupedData].reverse(); // Chart.js expects chronological order

    const odometerData = reversedData.map(d => ({ x: new Date(d.date).getTime(), y: d.odometerMovement }));
    const mpgData = reversedData.map(d => ({ x: new Date(d.date).getTime(), y: d.mpg }));

    groupedHistoryChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Odometer Movement (mi)',
                    data: odometerData,
                    borderColor: '#3b82f6',
                    yAxisID: 'yOdometer',
                    tension: 0.1,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: 'MPG',
                    data: mpgData,
                    borderColor: '#f59e0b',
                    yAxisID: 'yMPG',
                    tension: 0.1,
                    pointRadius: 2,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day', displayFormats: { day: 'MM/dd' } },
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                yOdometer: {
                    type: 'linear', position: 'left', beginAtZero: true,
                    title: { display: true, text: 'Odometer Movement (mi)', color: '#3b82f6' },
                    ticks: { color: '#94a3b8' },
                    grid: { drawOnChartArea: false }
                },
                 yMPG: {
                    type: 'linear', position: 'right', beginAtZero: true,
                    title: { display: true, text: 'MPG', color: '#f59e0b' },
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            },
            plugins: {
                legend: { position: 'bottom', labels: { color: '#e2e8f0', usePointStyle: false, boxWidth: 25, boxHeight: 2, padding: 20 } },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const timestamp = context[0].parsed.x;
                            return new Date(timestamp).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
                        }
                    }
                }
            }
        }
    });
}


/**
 * Filters and renders the history data based on the selected day range.
 * @param {string} days The number of days to show ('all' for everything).
 * @param {Array<Object>} unmatchedPurchases The list of purchases that couldn't be matched.
 */
function filterAndRenderHistory(days, unmatchedPurchases = []) {
    let filteredData = fullHistoryData;
    if (days !== 'all' && fullHistoryData.length > 0) {
        const numDays = parseInt(days, 10);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - numDays);
        
        filteredData = fullHistoryData.filter(row => {
            return new Date(row.hour_timestamp) >= cutoffDate;
        });
    }
    const isGrouped = document.getElementById('history-group-toggle').checked;
    renderFuelTable(filteredData, unmatchedPurchases, isGrouped);
}


/**
 * Merges hourly MPG data with discrete fuel purchase events.
 * @param {Array<Object>} mpgData Hourly data from Samsara.
 * @param {Array<Object>} fuelPurchaseData Fuel purchase events.
 * @returns {Array<Object>} A unified array with purchase data attached to the closest hourly record.
 */
function mergeFuelData(mpgData, fuelPurchaseData) {
    // --- 1. SETUP ---
    if (!fuelPurchaseData || fuelPurchaseData.length === 0) {
        return { mpgData, unmatchedPurchases: [] };
    }

    // **FIX IS HERE:** Added a .filter() to ensure every hourly record has a timestamp before mapping.
    const mpgDataMap = new Map(
        mpgData
            .filter(d => d.hour_timestamp) // This new line prevents the error
            .map(d => {
                const hourlyDate = new Date(d.hour_timestamp);
                hourlyDate.setUTCMinutes(0, 0, 0);
                const key = hourlyDate.toISOString();
                return [key, d];
            })
    );

    const unmatchedPurchases = [];

    // --- 2. MATCHING LOGIC ---
    // Filter for valid purchases is kept as a safeguard
    const validFuelPurchases = fuelPurchaseData.filter(p => p.date);

    validFuelPurchases.forEach(purchase => {
        const purchaseDate = new Date(purchase.date);
        const targetHourTimestamp = new Date(purchaseDate);
        targetHourTimestamp.setUTCMinutes(0, 0, 0);
        const targetHourString = targetHourTimestamp.toISOString();

        let targetRecord = mpgDataMap.get(targetHourString);

        if (targetRecord) {
            const primaryFuelMovement = parseFloat(targetRecord.fuel_movement);
            if (primaryFuelMovement < 0) {
                for (let i = 1; i <= 3; i++) {
                    const nextHourTimestamp = new Date(targetHourTimestamp);
                    nextHourTimestamp.setUTCHours(nextHourTimestamp.getUTCHours() + i);
                    const nextHourString = nextHourTimestamp.toISOString();
                    const secondaryMatch = mpgDataMap.get(nextHourString);
                    if (secondaryMatch && parseFloat(secondaryMatch.fuel_movement) > 0) {
                        targetRecord = secondaryMatch;
                        break;
                    }
                }
            }
        } else {
            for (let i = 1; i <= 3; i++) {
                const aheadTimestamp = new Date(targetHourTimestamp);
                aheadTimestamp.setUTCHours(aheadTimestamp.getUTCHours() + i);
                const aheadMatch = mpgDataMap.get(aheadTimestamp.toISOString());
                if (aheadMatch) {
                    targetRecord = aheadMatch;
                    break;
                }
                const behindTimestamp = new Date(targetHourTimestamp);
                behindTimestamp.setUTCHours(behindTimestamp.getUTCHours() - i);
                const behindMatch = mpgDataMap.get(behindTimestamp.toISOString());
                if (behindMatch) {
                    targetRecord = behindMatch;
                    break;
                }
            }
        }

        if (targetRecord) {
            targetRecord.fuelUp_Date = purchase.date;
            targetRecord.fuelUp_Quantity = purchase.quantity;
            targetRecord.fuelUp_Amount = purchase.amount;
        } else {
            unmatchedPurchases.push(purchase);
        }
    });

    return { mpgData: Array.from(mpgDataMap.values()), unmatchedPurchases };
}

/**
 * Opens and populates the historical data modal.
 * @param {Object} driver The driver object for the selected row.
 * @param {Function} safetyFetcher The async function to fetch safety data.
 * @param {Function} fuelFetcher The async function to fetch fuel data.
 */
export async function openHistoryModal(driver, safetyFetcher, fuelFetcher, poFetcher, fuelPurchaseFetcher, changelogFetcher, mileageData) {
    const modal = document.getElementById('history-modal');
    const fuelContent = document.getElementById('fuel-content');
    const daysFilter = document.getElementById('history-days-filter');
    const groupToggle = document.getElementById('history-group-toggle');

    document.getElementById('history-driver-name').textContent = driver.name;
    switchHistoryTab('safety');
    
    const loadingMessage = `<p class="text-slate-500 text-center py-10">Loading data...</p>`;
    document.getElementById('changelog-content').innerHTML = loadingMessage;
    document.getElementById('safety-content').innerHTML = loadingMessage;
    document.getElementById('fuel-content').innerHTML = loadingMessage;
    document.getElementById('pos-content').innerHTML = loadingMessage;
    
    daysFilter.value = 'all';
    groupToggle.checked = false;

    // Destroy all possible chart instances to prevent memory leaks
    if (historyChart) { historyChart.destroy(); historyChart = null; }
    if (groupedHistoryChart) { groupedHistoryChart.destroy(); groupedHistoryChart = null; }
    if (safetyChart) { safetyChart.destroy(); safetyChart = null; }
    if (poChart) { poChart.destroy(); poChart = null; }
    fullHistoryData = [];

    if (historyModalClickListener) {
        fuelContent.removeEventListener('click', historyModalClickListener);
    }
    daysFilter.onchange = null;
    groupToggle.onchange = null;

    modal.classList.remove('hidden');

    const [safetyData, mpgData, poData, fuelPurchaseData, changelogData] = await Promise.all([
        safetyFetcher(driver.name),
        fuelFetcher(driver.name),
        poFetcher(driver.name),
        fuelPurchaseFetcher(driver.name),
        changelogFetcher(driver.name) // Fetch the log for the specific driver
    ]);
    
    const { mpgData: mergedMpgData, unmatchedPurchases } = mergeFuelData(mpgData, fuelPurchaseData);
    fullHistoryData = mergedMpgData; 

    renderChangelogTable(changelogData, mileageData, driver.name);
    renderSafetyTable(safetyData);
    renderPOTable(poData);
    renderFuelTable(fullHistoryData, unmatchedPurchases, groupToggle.checked); 

    const rerenderFuelView = () => {
        filterAndRenderHistory(daysFilter.value, unmatchedPurchases);
    };

    daysFilter.onchange = rerenderFuelView;
    groupToggle.onchange = rerenderFuelView;

    historyModalClickListener = (e) => {
        const row = e.target.closest('tr');
        if (!row || !historyChart || !row.dataset.timestamp) return;
        
        const timestamp = row.dataset.timestamp;
        document.querySelectorAll('#fuel-content .history-table tbody tr').forEach(r => r.classList.remove('row-highlight'));
        row.classList.add('row-highlight');
        
        const tableRows = Array.from(document.querySelectorAll('#fuel-content .history-table tbody tr'));
        const clickedRowIndex = tableRows.findIndex(r => r.dataset.timestamp === timestamp);
        
        if (clickedRowIndex !== -1) {
            const dataIndex = (tableRows.length - 1) - clickedRowIndex;
            historyChart.tooltip.setActiveElements([{ datasetIndex: 0, index: dataIndex }, { datasetIndex: 1, index: dataIndex }]);
            historyChart.update();
        }
    };
    fuelContent.addEventListener('click', historyModalClickListener);
}

/** Closes the historical data modal. */
export function closeHistoryModal() {
    document.getElementById('history-modal').classList.add('hidden');
}

/**
 * Renders the historical data chart for safety events.
 * @param {Array<Object>} safetyData The historical safety data.
 */
function renderSafetyChart(safetyData) {
    const ctx = document.getElementById('safety-history-chart');
    if (!ctx) return;
    if (safetyChart) safetyChart.destroy();

    const reversedData = [...safetyData].reverse();

    const chartData = reversedData.map(d => {
        const date = new Date(d.date);
        const speedingEvents = (parseInt(d.lightSpeeding, 10) || 0) + (parseInt(d.moderateSpeeding, 10) || 0) + (parseInt(d.heavySpeeding, 10) || 0) + (parseInt(d.severeSpeeding, 10) || 0);
        const behaviors = (parseInt(d.harshBrake, 10) || 0) + (parseInt(d.harshTurn, 10) || 0);
        return {
            x: date.getTime(),
            safetyScore: parseFloat(d.safetyScore),
            speedingEvents: speedingEvents,
            behaviors: behaviors
        };
    });

    safetyChart = new Chart(ctx, {
        type: 'line',
        plugins: [verticalLinePlugin],
        data: {
            datasets: [
                {
                    label: 'Safety Score',
                    data: chartData.map(d => ({ x: d.x, y: d.safetyScore })),
                    borderColor: '#3b82f6',
                    yAxisID: 'yScore',
                    tension: 0.1,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: 'Speeding Events',
                    data: chartData.map(d => ({ x: d.x, y: d.speedingEvents })),
                    borderColor: '#f59e0b',
                    yAxisID: 'yEvents',
                    tension: 0.1,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: 'Harsh Behaviors',
                    data: chartData.map(d => ({ x: d.x, y: d.behaviors })),
                    borderColor: '#ef4444',
                    yAxisID: 'yEvents',
                    tension: 0.1,
                    pointRadius: 2,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day', displayFormats: { day: 'MM/dd' } },
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                yEvents: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Events / Behaviors', color: '#e2e8f0' },
                    ticks: { color: '#94a3b8' },
                    grid: { drawOnChartArea: false }
                },
                yScore: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 100,
                    title: { display: true, text: 'Safety Score (%)', color: '#3b82f6' },
                    ticks: { color: '#94a3b8', callback: value => `${value}%` },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            },
            plugins: {
                legend: { position: 'bottom', labels: { color: '#e2e8f0', usePointStyle: false, boxWidth: 25, boxHeight: 2, padding: 20 } },
                tooltip: {
                     callbacks: {
                        title: function(context) {
                            const timestamp = context[0].parsed.x;
                            return new Date(timestamp).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
                        }
                    }
                }
            }
        }
    });
}

/**
 * Switches the visible tab in the history modal and manages UI elements.
 * @param {string} tabNameToActivate The name of the tab to show (e.g., 'safety', 'fuel').
 */
export function switchHistoryTab(tabNameToActivate) {
    const viewOptionsContainer = document.getElementById('history-view-options');

    document.querySelectorAll('.history-tab').forEach(tab => {
        const isTargetTab = tab.dataset.tab === tabNameToActivate;
        tab.classList.toggle('active-tab', isTargetTab);
        tab.classList.toggle('text-white', isTargetTab);
        tab.classList.toggle('border-blue-500', isTargetTab);
    });

    document.querySelectorAll('.history-tab-content').forEach(content => {
        content.classList.toggle('hidden', content.id !== `${tabNameToActivate}-content`);
    });

    // Show the "Group by Day" toggle ONLY for the fuel tab
    const shouldShowOptions = tabNameToActivate === 'fuel';
    if (viewOptionsContainer) {
        viewOptionsContainer.classList.toggle('hidden', !shouldShowOptions);
    }
}


/**
 * Renders the PO history table and chart.
 * @param {Array<Object>} data The PO data to render.
 */
function renderPOTable(data) {
    const container = document.getElementById('pos-content');
    if (!data || data.length === 0) {
        container.innerHTML = `<p class="text-slate-500 text-center py-10">No Purchase Order history found for this driver.</p>`;
        return;
    }

    const tableHtml = `
        <div class="history-table-wrapper">
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Transaction Date</th>
                        <th>Expense Reason</th>
                        <th>Description</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map(row => {
                        const date = new Date(row.transaction_date);
                        const formattedDate = date.toLocaleDateString('en-US', {
                            month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC'
                        });
                        const amount = parseFloat(row.amount);
                        const formattedAmount = isNaN(amount) ? '-' : `$${amount.toFixed(2)}`;
                        return `
                            <tr>
                                <td>${formattedDate}</td>
                                <td>${row.expense_reason || '-'}</td>
                                <td>${row.description || '-'}</td>
                                <td>${formattedAmount}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div class="chart-container">
            <canvas id="po-history-chart"></canvas>
        </div>`;
    container.innerHTML = tableHtml;
    renderPOChart(data);
}

/**
 * Renders the historical bar chart for PO amounts.
 * @param {Array<Object>} poData The historical PO data.
 */
function renderPOChart(poData) {
    const ctx = document.getElementById('po-history-chart');
    if (!ctx) return;
    if (poChart) poChart.destroy();

    const reversedData = [...poData].reverse();

    const chartData = reversedData.map(d => ({
        x: new Date(d.transaction_date).getTime(),
        y: parseFloat(d.amount) || 0
    }));

    poChart = new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [{
                label: 'PO Amount ($)',
                data: chartData,
                backgroundColor: '#3b82f6',
                borderColor: '#2563eb',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day', displayFormats: { day: 'MM/dd/yy' } },
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Amount ($)', color: '#e2e8f0' },
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const timestamp = context[0].parsed.x;
                            return new Date(timestamp).toLocaleDateString('en-US', { timeZone: 'UTC' });
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}