/**
 * ui.js
 * * Contains all functions that directly manipulate the DOM, such as rendering
 * tables, opening/closing panels, and updating UI elements.
 */
import { calculateMpgPercentile, calculateSpeedingPercentile, getDriverReportData } from './calculations.js';
import { columnConfig } from './config.js';
import { mergeFuelData } from './fuelTankAnalysis.js';

// Helper function for creating toggle switches
const createToggleCheckbox = (id, label, isChecked) => {
    return `
        <label for="${id}" class="flex items-center justify-between cursor-pointer">
            <span class="text-sm font-medium text-slate-300">${label}</span>
            <div class="relative">
                <input type="checkbox" id="${id}" class="metric-toggle-checkbox sr-only" ${isChecked ? 'checked' : ''}>
                <div class="block bg-slate-600 w-10 h-6 rounded-full"></div>
                <div class="dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform"></div>
            </div>
        </label>
    `;
};

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
        // FIX: Add a guard clause to ensure chart.tooltip exists before use.
        // This prevents a crash when the plugin runs before the tooltip is initialized,
        // often during a resize event.
        if (!chart.tooltip) {
            return;
        }

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
/**
 * Renders the main data table header.
 */
export function renderTableHeader(orderedColumnKeys, visibleColumnKeys, pinnedColumns, currentUser) {
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
        
        // --- NEW: Bulk Actions in Header for Admin ---
        let headerContent = config.title;
        if (key === 'actions' && currentUser && currentUser.role.trim() === 'Admin') {
            headerContent = `
                <div class="flex items-center justify-center gap-2">
                    <span>${config.title}</span>
                    <button id="bulk-lock-btn" class="hidden bg-blue-600 hover:bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded shadow transition-colors" title="Lock Selected">
                        Lock
                    </button>
                    <input type="checkbox" id="select-all-drivers" class="w-4 h-4 rounded bg-slate-800 border-slate-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900 cursor-pointer" style="color-scheme: dark;" title="Select All">
                </div>
            `;
        }
        // ---------------------------------------------

        th.innerHTML = `
            <div class="flex items-center justify-between w-full gap-1">
                <span class="flex-grow">${headerContent}</span>
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
                            ${(pinnedColumns.left.includes(key) || pinnedColumns.right.includes(key)) ? `<a href="#" class="flex items-center gap-2 px-4 py-2 text-slate-700 hover:bg-slate-100" data-action="unpin"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg><span>Unpin</span></a>` : ''}
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
 */
export function renderTable(data, state, currentUser) {
    const { orderedColumnKeys, visibleColumnKeys, pinnedColumns, settings, overriddenDistances } = state;
    // Pass currentUser to the header renderer
    renderTableHeader(orderedColumnKeys, visibleColumnKeys, pinnedColumns, currentUser);
    
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
            const activeOverride = driver.isLocked ? driver.distanceSource : overriddenDistances[overrideKey];
            
            // Conditionally add classes based on distance source and user role
            if (key === 'milesWeek') {
                cellClass += activeOverride === 'samsaraDistance' ? ' distance-prologs-inactive' : ' distance-prologs-active';
                if (currentUser && currentUser.role.trim() === 'Admin' && !driver.isLocked) {
                    cellClass += ' distance-clickable';
                }
            } else if (key === 'samsaraDistance') {
                cellClass += activeOverride === 'samsaraDistance' ? ' distance-samsara-active' : ' distance-samsara-inactive';
                 if (currentUser && currentUser.role.trim() === 'Admin' && !driver.isLocked) {
                    cellClass += ' distance-clickable';
                }
            }
            cell.className = cellClass;
            
            let content = driver[key];
            if (key === 'name') {
                let icons = '<div class="flex items-center gap-1.5">';
                // FIX: Check the flags for source data existence, not the edited values
                if (driver.hasPrologsData) {
                    icons += '<div class="tooltip-container" data-tooltip="ProLogs data available"><div class="data-indicator indicator-p">P</div></div>';
                }
                if (driver.hasSamsaraData) {
                    icons += '<div class="tooltip-container" data-tooltip="Safety/Samsara data available"><div class="data-indicator indicator-s">S</div></div>';
                }
                icons += '</div>';
                content = `<div class="flex items-center gap-2">${driver.name}${icons}</div>`;
            }
            
            const isTpogContract = driver.contract_type === 'TPOG';
        
        // --- FIX: Check if driver is locked. If so, use stored values. If not, calculate new ones. ---
        // The `driver` object for a locked driver already has all the calculated fields from the snapshot.
        // The `driver` object for an *unlocked* driver needs them to be calculated now.
        const reportData = (isTpogContract && !driver.isLocked) ? getDriverReportData(driver, settings) : null;
        // --- END FIX ---

        if (key === 'availableOffDays') {
            if (driver.isLocked) {
                content = driver.availableOffDays; // Use the value from the snapshot
            } else {
                // If an override value exists (from edit panel), use it. Otherwise, use the calculated value.
                content = driver.hasOwnProperty('availableOffDays') ? driver.availableOffDays : (reportData ? reportData.availableOffDays : '-');
            }
        } else if (key === 'escrowDeduct') {
            let escrowValue;
            if (driver.isLocked) {
                escrowValue = driver.escrowDeduct || 0; // Use the value from the snapshot
            } else {
                // If an override value exists (from edit panel), use it. Otherwise, use the calculated value.
                escrowValue = driver.hasOwnProperty('escrowDeduct') ? driver.escrowDeduct : (reportData ? reportData.escrowDeduct : 0);
            }
            
            if (escrowValue > 0) {
                    content = `-$${parseFloat(escrowValue).toFixed(2)}`;
                    cell.style.color = '#f87171'; // Red color for deductions
                } else {
                    content = '-';
                }
            } else if (key === 'offDays') {
                content = driver.offDays || 0;
            } else if (key === 'weeksOut') {
                const value = parseFloat(driver.weeksOut);
                if (settings.weeksOutMethod === 'dailyAccrual') {
                    content = isNaN(value) ? '0.0' : value.toFixed(1);
                } else {
                    content = isNaN(value) ? '0' : value.toFixed(0);
                }
            } else if (key === 'bonuses') {
                // Use the pre-calculated reportData for unlocked, or the driver object for locked.
                const dataToUse = driver.isLocked ? driver : reportData;

                if (!isTpogContract || !dataToUse || !dataToUse.bonuses || !dataToUse.totalPositiveBonuses || dataToUse.totalPositiveBonuses === 0) {
                    content = '-';
                } else {
                    // No recalculation needed. Just use the values.
                    const bonusValue = dataToUse.totalPositiveBonuses;
                    const bonusDollars = (bonusValue / 100) * (driver.gross || 0);
                    const breakdown = Object.entries(dataToUse.bonuses)
                        .filter(([_, data]) => data.bonus > 0)
                        .map(([name, data]) => `${name}: +${data.bonus.toFixed(1)}% ($${((data.bonus / 100) * (driver.gross || 0)).toFixed(2)})`)
                        .join('|'); // Use a separator

                    content = `<div class="tooltip-container" data-tooltip-type="breakdown" data-tooltip-title="Bonuses Breakdown" data-tooltip-breakdown="${breakdown}">
                                 <span>+${bonusValue.toFixed(1)}%</span>
                                 <span class="text-xs text-slate-400">($${bonusDollars.toFixed(0)})</span>
                               </div>`;
                    
                    cell.style.color = '#4ade80'; // Green color for bonuses
                }
            } else if (key === 'penalties') {
                // Use the pre-calculated reportData for unlocked, or the driver object for locked.
                const dataToUse = driver.isLocked ? driver : reportData;

                if (!isTpogContract || !dataToUse || !dataToUse.bonuses || !dataToUse.totalPenalties || dataToUse.totalPenalties === 0) {
                    content = '-';
                } else {
                    // No recalculation needed. Just use the values.
                    const penaltyValue = dataToUse.totalPenalties;
                    const penaltyDollars = (penaltyValue / 100) * (driver.gross || 0);
                    const breakdown = Object.entries(dataToUse.bonuses)
                        .filter(([_, data]) => data.bonus < 0)
                        .map(([name, data]) => `${name}: ${data.bonus.toFixed(1)}% ($${((data.bonus / 100) * (driver.gross || 0)).toFixed(2)})`)
                        .join('|'); // Use a separator
                    
                    content = `<div class="tooltip-container" data-tooltip-type="breakdown" data-tooltip-title="Penalties Breakdown" data-tooltip-breakdown="${breakdown}">
                                 <span>${penaltyValue.toFixed(1)}%</span>
                                 <span class="text-xs text-slate-400">($${penaltyDollars.toFixed(0)})</span>
                               </div>`;

                    cell.style.color = '#f87171'; // Red color for penalties
                }
            } else if (key === 'totalTpog') {
                // Use the pre-calculated reportData for unlocked, or the driver object for locked.
                const dataToUse = driver.isLocked ? driver : reportData;

                if (!isTpogContract || !dataToUse) {
                    content = '-';
                } else {
                    // No recalculation needed. Just use the stored 'totalTpog' and 'estimatedNet'
                    const tpog = dataToUse.totalTpog || 0; // Get snapshot value
                    const estimatedNet = dataToUse.estimatedNet || 0; // Get snapshot value
                    content = `<span class="font-bold" style="color: #e2b340;">${tpog.toFixed(1)}%</span> <span class="text-xs text-slate-400">($${Math.round(estimatedNet)})</span>`;
                }
            } else if (key === 'actions') {
                if (!isTpogContract) {
                    content = '-';
                } else {
                    const isAdmin = currentUser && currentUser.role.trim() === 'Admin';
                    let contentHtml = `<div class="flex items-center justify-center gap-2 whitespace-nowrap">`;

                    // VIEW BUTTON (Common for both)
                    const viewBtn = `<button class="view-report-btn p-0 rounded-full hover:bg-slate-700 text-slate-400 hover:text-blue-400" data-driver-id="${driver.id}" title="View Report"><svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg></button>`;

                    if (driver.isLocked) {
                        // --- Locked View ---
                        contentHtml += viewBtn;
                        contentHtml += `<button class="download-btn p-0 rounded-full hover:bg-slate-700" data-driver-id="${driver.id}" title="Download Automatic Report"><svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></button>`;
                        
                        if (isAdmin) {
                            contentHtml += `<button class="unlock-btn p-0 rounded-full hover:bg-slate-700 text-blue-400" data-driver-id="${driver.id}" title="Unlock Week"><svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clip-rule="evenodd" /></svg></button><span class="text-xs font-semibold text-blue-400">LOCKED</span>`;
                        } else {
                            contentHtml += `<div class="p-0 text-blue-400" title="Week is locked"><svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clip-rule="evenodd" /></svg></div>`;
                        }
                    } else {
                        // --- Unlocked View ---
                        contentHtml += `<button class="copy-btn p-0 rounded-full hover:bg-slate-700" data-driver-id="${driver.id}" title="Copy Report Explanation"><svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                                    <button class="edit-btn p-0 rounded-full hover:bg-slate-700" data-driver-id="${driver.id}" title="Edit & Download Report"><svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z"></path></svg></button>
                                    ${viewBtn}
                                    <button class="download-btn p-0 rounded-full hover:bg-slate-700" data-driver-id="${driver.id}" title="Download Automatic Report"><svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></button>
                                    <button class="lock-btn p-0 rounded-full hover:bg-slate-700 text-slate-400" data-driver-id="${driver.id}" title="Lock Week"><svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2V7a5 5 0 00-5-5zM8.5 7V5.5a1.5 1.5 0 113 0V7h-3z" /></svg></button>`;
                        
                        if (isAdmin) {
                            contentHtml += `<input type="checkbox" class="driver-select-checkbox w-4 h-4 rounded bg-slate-800 border-slate-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900 cursor-pointer ml-2" style="color-scheme: dark;" value="${driver.id}" title="Select Driver">`;
                        }
                    }
                    contentHtml += `</div>`;
                    content = contentHtml;
                }
            // WITH THIS
        } else if (key === 'weeklyActivity') {
            if (driver.weeklyActivity && driver.weeklyActivity.length === 7) {
                let activityBlocksHtml = '';
                driver.weeklyActivity.forEach(activity => {
                    let colorClass = 'activity-red'; 
                    const statuses = (activity.statuses || '').toUpperCase();
                    
                    // --- UPDATED COLOR LOGIC ---
                        // 1. Grey Statuses (High Priority)
                        if (statuses.includes('NOT_STARTED') || statuses.includes('CONTRACT_ENDED')) {
                            colorClass = 'activity-grey';
                        }
                        // 2. Red Statuses
                        else if (statuses.includes('DAY_OFF')) { 
                            colorClass = 'activity-red'; 
                        } 
                        // 3. Orange Statuses
                        else if (statuses.includes('WITHOUT_LOAD')) { 
                            colorClass = 'activity-orange'; 
                        } 
                        // 4. Green Statuses
                        else if (statuses.includes('ACTIVE')) { 
                            colorClass = 'activity-green'; 
                        } 
                        // 5. Mileage Check (Green) - Catches "No Data" but with miles
                        else if (activity.mileage > 0) { 
                            colorClass = 'activity-green'; 
                        } 
                        // 6. Grey "No Data" (Only if no miles)
                        else if (statuses.includes('NO DATA')) { 
                            colorClass = 'activity-grey'; 
                        } 
                        // 7. Default Red
                        else { 
                            colorClass = 'activity-red'; 
                        }
                        // ---------------------------
        
                    const miles = activity.mileage.toFixed(0);
                    const mileLabel = miles === "1" ? "mile" : "mi";
                    let tooltipText = `${activity.fullDate} - ${miles} ${mileLabel}. Status: ${activity.statuses}`;
                    if (activity.isChanged) {
                        tooltipText = `${activity.fullDate} - ${miles} ${mileLabel}. Status: ${activity.tooltipStatus}`;
                    }
        
                    // Overlay class removed
        
                    activityBlocksHtml += `<div class="tooltip-container" data-tooltip="${tooltipText}">
                                        <div class="weekly-activity-block ${colorClass}">${activity.day}</div>
                                    </div>`;
                });
        
                let checkmarkHtml = '';
                if (driver.isDispatcherReviewed) {
                    checkmarkHtml = `
                    <div class="tooltip-container" data-tooltip="Reviewed by Dispatcher">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                        </svg>
                    </div>`;
                }
                
                let noteHtml = '';
                if (driver.weeklyNote) {
                    // We must escape the note content to safely use it in an HTML attribute
                    const escapedNote = driver.weeklyNote.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                    noteHtml = `
                    <div class="tooltip-container" data-tooltip="${escapedNote}">
                        <svg class="note-indicator-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                            <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                        </svg>
                    </div>`;
                }
                
        
                content = `<div class="flex items-center justify-center gap-2">
                            <button class="show-history-btn p-0 rounded-full hover:bg-slate-700" data-driver-id="${driver.id}" title="Show Historical Activity">
                                <svg class="w-5 h-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                </svg>
                            </button>
                            <div class="flex justify-center items-center gap-0.5">${activityBlocksHtml}</div>
                            ${checkmarkHtml}
                            ${noteHtml}
                           </div>`;
            } else {
                content = '-';
            }
            
            
        } else if (key === 'stubMpg') {
            const val = parseFloat(driver.stubMpg);
            content = (isNaN(val) || val === 0) ? '-' : val.toFixed(1);
            
            // FIX: Use default fallback for old locks
            const source = driver.mpgSource || 'mpg';
            if (source === 'stubMpg') cell.classList.add('mpg-source-active');
            else cell.classList.add('mpg-source-inactive');
            
            if (currentUser && currentUser.role.trim() === 'Admin' && !driver.isLocked) {
                cell.classList.add('mpg-clickable');
            }

        } else if (key === 'mpg') {
            // FIX: Respect manual edits when MPG is the active source.
            // Only recalculate if we are in Stub mode (where driver.mpg holds the Stub value)
            // and we need to display the underlying Samsara value for this column.
            
            const source = driver.mpgSource || 'mpg';
            let displayVal = 0;

            if (source === 'mpg') {
                // If Samsara is active, trust the driver.mpg value (it contains your manual edit)
                displayVal = parseFloat(driver.mpg) || 0;
            } else {
                // If Stub is active, driver.mpg = Stub Value. We must recalculate Samsara MPG for this column.
                const dist = driver.distanceSource === 'samsaraDistance' ? driver.samsaraDistance : driver.milesWeek;
                const gals = parseFloat(driver.gallons_fictive);
                if (gals > 0 && dist > 0) displayVal = dist / gals;
            }

            content = displayVal.toFixed(1);

            // FIX: Add styling classes directly to the element classList
            if (source === 'mpg') cell.classList.add('mpg-source-active');
            else cell.classList.add('mpg-source-inactive');
            
            if (currentUser && currentUser.role.trim() === 'Admin' && !driver.isLocked) {
                cell.classList.add('mpg-clickable');
            }

        } else if (key === 'mpgPercentile') {
                content = `${parseFloat(driver.mpgPercentile)}%`;
            } else if (key === 'samsaraDistance') {
                content = driver.samsaraDistance > 0 ? driver.samsaraDistance : '-';
            } else if (key === 'gross') {
                const value = parseFloat(content);
                if (value === 0) {
                    content = '-';
                } else {
                    content = `$${Math.round(value)}`;
                }
            } else if (key === 'rpm') {
                const value = parseFloat(content);
                if (value === 0) {
                    content = '-';
                } else {
                    content = `$${value.toFixed(2)}`;
                }
            } else if (key === 'estimatedNet') {
                // Use the pre-calculated reportData for unlocked, or the driver object for locked.
                const dataToUse = driver.isLocked ? driver : reportData;

                if (!isTpogContract || !dataToUse) {
                    content = '-';
                } else {
                    const netValue = dataToUse.estimatedNet; // Get snapshot or calculated value
                    if (netValue === 0) {
                       content = '-';
                    } else {
                       content = `$${Math.round(netValue)}`;
                }}
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
    // **FIX 2.0:** Use requestAnimationFrame for the pinning update. This is the modern
    // way to sync DOM changes with the browser's repaint cycle, which should be
    // faster and smoother than setTimeout, eliminating the initial delay.
    requestAnimationFrame(() => {
        updateColumnPinning(pinnedColumns);
    });
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
        // This 'if' block is correct:
        if (!headerCell) return; // Skips if column is hidden
        const cells = document.querySelectorAll(`[data-key="${key}"]`);
        cells.forEach(cell => {
            cell.classList.add('pinned-left');
            cell.style.left = `${leftOffset}px`;
        });
        leftOffset += headerCell.getBoundingClientRect().width; // <--- MODIFIED THIS LINE
    });

    let rightOffset = 0;
    // THIS IS THE BLOCK TO REPLACE
    // We iterate over the pinned columns in reverse order
    [...pinnedColumns.right].reverse().forEach(key => {
        const headerCell = document.querySelector(`th[data-key="${key}"]`);
        
        // This check is crucial. If the header cell isn't rendered
        // (because the column is hidden), we skip everything
        // for this column and do NOT add any offset.
        if (headerCell) {
            const cells = document.querySelectorAll(`[data-key="${key}"]`);
            cells.forEach(cell => {
                cell.classList.add('pinned-right');
                cell.style.right = `${rightOffset}px`;
            });
            // We only add the width to the offset if the column was found
            rightOffset += headerCell.getBoundingClientRect().width; // <--- MODIFIED THIS LINE
        }
        // If headerCell is null (column hidden), rightOffset is NOT
        // incremented, and the next visible column will be placed
        // correctly, closing the gap.
    });
}


const createRangeBonusEditor = (key, title, tooltipText, settings) => {
    // --- START: Configuration based on key ---
    let fromLabel = 'From';
    let toLabel = 'To';
    let valueLabel = 'Value';
    let valueField = 'bonus'; // 'bonus' or 'penalty'
    let valuePlaceholder = 'e.g. 1.5';
    let fromPlaceholder = 'e.g. 0';
    let toPlaceholder = 'e.g. 1000';

    if (key === 'speedingRangeTiers') {
        fromLabel = 'From (Events)';
        toLabel = 'To (Events)';
        valueLabel = 'Penalty (%)';
        valueField = 'penalty';
        valuePlaceholder = 'e.g. -1.0';
        fromPlaceholder = 'e.g. 2';
        toPlaceholder = 'e.g. 10';
    } else if (key === 'grossTargetTiers') {
        fromLabel = 'From ($)';
        toLabel = 'To ($)';
        valueLabel = 'Bonus (%)';
        valueField = 'bonus';
        valuePlaceholder = 'e.g. 2.5';
        fromPlaceholder = 'e.g. 8000';
        toPlaceholder = ''; // Empty for "and up"
    }
    // --- END: Configuration ---

    const tiers = settings[key] || [];
    const tierRows = tiers.map((tier, index) => {
        // Use 'bonus' or 'penalty' field based on config
        const value = (valueField === 'bonus') ? tier.bonus : tier.penalty;
        return `
        <div class="tier-row grid grid-cols-[auto_auto_auto_auto] justify-start gap-x-3 items-center" data-tier-index="${index}">
            <input type="number" class="settings-input w-24" value="${tier.from ?? ''}" data-type="from" placeholder="${fromPlaceholder}">
            <input type="number" class="settings-input w-24" value="${tier.to !== Infinity ? (tier.to ?? '') : ''}" data-type="to" placeholder="${toPlaceholder}">
            <input type="number" step="0.1" class="settings-input w-24" value="${value ?? ''}" data-type="${valueField}" placeholder="${valuePlaceholder}">
            <button type="button" class="remove-tier-btn text-slate-500 hover:text-red-500 p-1 rounded-full transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
        </div>`
    }).join('');

    let tooltipHtml = tooltipText ? `
        <div class="tooltip-container ml-2" data-tooltip="${tooltipText}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>` : '';

    return `
        <div class="space-y-3" data-tier-key="${key}">
            <div class="flex items-center"><h3 class="text-base font-semibold text-slate-100">${title}</h3>${tooltipHtml}</div>
            <div>
                <div class="grid grid-cols-[auto_auto_auto_auto] justify-start gap-x-3 items-center text-xs font-medium text-slate-400 px-1">
                    <span>${fromLabel}</span><span>${toLabel}</span><span>${valueLabel}</span><span></span>
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

    // Conditionally create the title row
    const titleRow = title ? `<div class="flex items-center"><h3 class="text-base font-semibold text-slate-100">${title}</h3>${tooltipHtml}</div>` : (tooltipText ? `<div class="flex items-center">${tooltipHtml}</div>` : '');

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
            ${titleRow}
            <div class="grid grid-cols-[1fr_1fr_auto] gap-3 items-center text-xs font-medium text-slate-400 px-1"><span>Threshold (${unit})</span><span>Bonus (%)</span></div>
            <div class="space-y-2">${tierRows}</div>
            ${includeZerosCheckboxHtml}
            <button type="button" class="add-tier-btn text-sm font-semibold text-blue-500 hover:text-blue-400">+ Add Tier</button>
        </div>`;
};

export function renderSettingsContent(settings, openAccordionIndex = 0) {
    const tooltipText = 'The system applies the bonus/penalty for the highest tier the driver has passed. For example, a percentile of 89% would receive the reward for the 80% tier.';
    const speedingMethod = settings.speedingPenaltyMethod || 'percentile';
    const daysOffTooltipText = "A day is counted as a DAY_OFF if: Status is TIME_OFF and there is no load, OR Status is DROP_LIKELY and the truck is DROPPED.";

    // Chevron SVG for the accordion
    const chevronIcon = `
        <svg class="accordion-chevron w-5 h-5 text-slate-400 transition-transform" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
    `;

    settingsContent.innerHTML = `
        <div class="accordion-item bg-slate-800 rounded-lg shadow-sm border border-slate-700 overflow-hidden">
            <button class="accordion-header flex justify-between items-center w-full p-5 text-left">
                <h2 class="text-lg font-bold text-slate-100">Base Rate</h2>
                ${chevronIcon}
            </button>
            <div class="accordion-content overflow-hidden">
                <div class="p-5 border-t border-slate-700">
                    <div>
                        <p class="text-xs text-slate-400 mt-0.5">The starting percentage for all drivers.</p>
                        <input type="number" id="baseRate" class="settings-input mt-2" value="${settings.baseRate}">
                    </div>
                </div>
            </div>
        </div>

        <div class="accordion-item bg-slate-800 rounded-lg shadow-sm border border-slate-700 overflow-hidden">
            <button class="accordion-header flex justify-between items-center w-full p-5 text-left">
                <h2 class="text-lg font-bold text-slate-100">Active Bonus/Penalty Metrics</h2>
                ${chevronIcon}
            </button>
            <div class="accordion-content overflow-hidden" style="max-height: 0;">
                <div class="p-5 border-t border-slate-700 space-y-4">
                    <p class="text-xs text-slate-400 -mt-2">Uncheck any metric to completely disable it from all calculations and reports.</p>
                    ${createToggleCheckbox('metric-toggle-weeksOut', 'Performance (Weeks Out)', settings.enabledMetrics?.weeksOut ?? true)}
                    ${createToggleCheckbox('metric-toggle-safety', 'Safety (Score & Speeding)', settings.enabledMetrics?.safety ?? true)}
                    ${createToggleCheckbox('metric-toggle-fuel', 'Fuel Efficiency', settings.enabledMetrics?.fuel ?? true)}
                    ${createToggleCheckbox('metric-toggle-tenure', 'Tenure', settings.enabledMetrics?.tenure ?? true)}
                    ${createToggleCheckbox('metric-toggle-grossTarget', 'Gross Target', settings.enabledMetrics?.grossTarget ?? true)}
                </div>
            </div>
        </div>

        <div class="accordion-item bg-slate-800 rounded-lg shadow-sm border border-slate-700 overflow-hidden">
            <button class="accordion-header flex justify-between items-center w-full p-5 text-left">
                <h2 class="text-lg font-bold text-slate-100">Performance Bonuses</h2>
                ${chevronIcon}
            </button>
            <div class="accordion-content overflow-hidden" style="max-height: 0;">
                <div class="p-5 border-t border-slate-700 space-y-4">
                    <div>
                        <h3 class="text-base font-semibold text-slate-100">Weeks Out Policy</h3>
                        <p class="text-xs text-slate-400 mt-0.5 mb-3">A week is counted as "out" if the driver takes no days off.</p>
                        
                        <div>
                            <h4 class="text-sm font-medium text-slate-300 mb-2">Calculation Method</h4>
                            <div class="flex items-center space-x-6">
                                <label class="flex items-center space-x-2 cursor-pointer">
                                    <input type="radio" name="weeksOutMethod" value="fullWeeksOnly" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-500" ${settings.weeksOutMethod === 'fullWeeksOnly' || !settings.weeksOutMethod ? 'checked' : ''}>
                                    <span class="text-sm text-slate-300">Full Weeks Only</span>
                                </label>
                                <label class="flex items-center space-x-2 cursor-pointer">
                                    <input type="radio" name="weeksOutMethod" value="dailyAccrual" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-500" ${settings.weeksOutMethod === 'dailyAccrual' ? 'checked' : ''}>
                                     <span class="text-sm text-slate-300">Daily Accrual</span>
                                     <div class="tooltip-container" data-tooltip="Calculates 'Weeks Out' by adding 1/7th of a week for each active day. The streak accumulates daily and resets to zero after any 'day off'.">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div class="flex items-center mt-4">
                            <input type="checkbox" id="weeksOutResetOnDaysOff" class="h-4 w-4 rounded border-slate-500 text-blue-600 focus:ring-blue-500" ${settings.weeksOutResetOnDaysOff ? 'checked' : ''}>
                            <label for="weeksOutResetOnDaysOff" class="ml-2 block text-sm text-slate-300">Reset streak if any days off are taken</label>
                        </div>
                    </div>
                    <hr class="border-slate-700">
                    ${createTieredBonusEditor('weeksOutTiers', 'Weeks Out Bonus', 'Weeks', '', settings)}
                </div>
            </div>
        </div>

        <div class="accordion-item bg-slate-800 rounded-lg shadow-sm border border-slate-700 overflow-hidden">
            <button class="accordion-header flex justify-between items-center w-full p-5 text-left">
                <h2 class="text-lg font-bold text-slate-100">Safety</h2>
                ${chevronIcon}
            </button>
            <div class="accordion-content overflow-hidden" style="max-height: 0;">
                <div class="p-5 border-t border-slate-700 space-y-4">
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
            </div>
        </div>

        <div class="accordion-item bg-slate-800 rounded-lg shadow-sm border border-slate-700 overflow-hidden">
            <button class="accordion-header flex justify-between items-center w-full p-5 text-left">
                <h2 class="text-lg font-bold text-slate-100">Fuel Efficiency (Percentile)</h2>
                ${chevronIcon}
            </button>
            <div class="accordion-content overflow-hidden" style="max-height: 0;">
                <div class="p-5 border-t border-slate-700 space-y-4">
                    ${createTieredBonusEditor('mpgPercentileTiers', '', '%-ile', tooltipText, settings)}
                    <hr class="border-slate-700">
                    <div>
                        <h3 class="text-base font-semibold text-slate-100">Fuel Mileage Threshold</h3>
                        <p class="text-xs text-slate-400 mt-0.5">Ignore fuel bonus/penalty if weekly miles are below this value.</p>
                        <input type="number" id="fuelMileageThreshold" class="settings-input mt-2" value="${settings.fuelMileageThreshold || 0}">
                    </div>
                </div>
            </div>
        </div>

        <div class="accordion-item bg-slate-800 rounded-lg shadow-sm border border-slate-700 overflow-hidden">
            <button class="accordion-header flex justify-between items-center w-full p-5 text-left">
                <h2 class="text-lg font-bold text-slate-100">Tenure (Cumulative)</h2>
                ${chevronIcon}
            </button>
            <div class="accordion-content overflow-hidden" style="max-height: 0;">
                <div class="p-5 border-t border-slate-700 space-y-4">
                    ${createTieredBonusEditor('tenureMilestones', 'Retention Milestones', 'Weeks', '', settings)}
                </div>
            </div>
        </div>

        <div class="accordion-item bg-slate-800 rounded-lg shadow-sm border border-slate-700 overflow-hidden">
            <button class="accordion-header flex justify-between items-center w-full p-5 text-left">
                <h2 class="text-lg font-bold text-slate-100">Gross Target</h2>
                ${chevronIcon}
            </button>
            <div class="accordion-content overflow-hidden" style="max-height: 0;">
                <div class="p-5 border-t border-slate-700 space-y-4">
                    ${createRangeBonusEditor('grossTargetTiers', 'Bonus by Gross ($)', tooltipText, settings)}
                </div>
            </div>
        </div>

        <div class="accordion-item bg-slate-800 rounded-lg shadow-sm border border-slate-700 overflow-hidden">
            <button class="accordion-header flex justify-between items-center w-full p-5 text-left">
                <h2 class="text-lg font-bold text-slate-100">Other Policies</h2>
                ${chevronIcon}
            </button>
            <div class="accordion-content overflow-hidden" style="max-height: 0;">
                <div class="p-5 border-t border-slate-700 space-y-4">
                    <div>
                        <h3 class="text-base font-semibold text-slate-100">Down Time</h3>
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
            </div>
        </div>
    `;

    // --- Add Accordion Event Listeners ---
    settingsContent.querySelectorAll('.accordion-header').forEach(button => {
        button.addEventListener('click', () => {
            const item = button.closest('.accordion-item');
            const content = item.querySelector('.accordion-content');
            const isOpen = item.classList.contains('open');
            
            // Close all other accordions
            settingsContent.querySelectorAll('.accordion-item.open').forEach(openItem => {
                if (openItem !== item) {
                    openItem.classList.remove('open');
                    openItem.querySelector('.accordion-content').style.maxHeight = '0';
                }
            });

            // Toggle the clicked one
            if (isOpen) {
                content.style.maxHeight = '0';
                item.classList.remove('open');
            } else {
                content.style.maxHeight = content.scrollHeight + 'px';
                item.classList.add('open');
            }
        });
    });

    // --- Set the accordion state based on openAccordionIndex ---
    const allAccordions = settingsContent.querySelectorAll('.accordion-item');
    const itemToOpen = allAccordions[openAccordionIndex];

    if (itemToOpen) {
        itemToOpen.classList.add('open'); // Add 'open' class to the target
        const content = itemToOpen.querySelector('.accordion-content');
        if (content) {
            // Use a small timeout to allow the browser to render and calculate scrollHeight
            setTimeout(() => {
                if (itemToOpen.classList.contains('open')) { // Check if it's still open
                    content.style.maxHeight = content.scrollHeight + 'px';
                }
            }, 50); // 50ms delay is safer
        }
    }
    // --- End Accordion Logic ---


    document.querySelectorAll('input[name="speedingPenaltyMethod"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const selectedMethod = e.target.value;
            document.getElementById('speeding-percentile-settings').classList.toggle('hidden', selectedMethod !== 'percentile');
            document.getElementById('speeding-per-event-settings').classList.toggle('hidden', selectedMethod !== 'perEvent');
            document.getElementById('speeding-range-settings').classList.toggle('hidden', selectedMethod !== 'range');
            
            // --- FIX: Adjust max-height when content changes ---
            const openAccordion = e.target.closest('.accordion-item.open');
            if (openAccordion) {
                const content = openAccordion.querySelector('.accordion-content');
                // Use timeout to let DOM update before measuring
                setTimeout(() => {
                    if (openAccordion.classList.contains('open')) { // Check if it's still open
                        content.style.maxHeight = content.scrollHeight + 'px';
                    }
                }, 50); // 50ms delay
            }
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
 * Helper: Generates the SVG string for the driver report.
 */
function generateReportSVG(driverData, settings, driversForDate) {
    // Check if the driver is locked AND has a 'lockedSettings' snapshot.
    const settingsToUse = (driverData.isLocked && driverData.lockedSettings) 
                           ? driverData.lockedSettings 
                           : settings;

    const formatNumber = (num) => (num % 1 === 0 ? num.toFixed(0) : num.toFixed(1));
    const formatCurrency = (num) => {
        const numericValue = parseFloat(num);
        if (isNaN(numericValue)) return '$0';
        const roundedNum = Math.round(numericValue);
        if (roundedNum === 0) return '$0';
        return `-$${Math.abs(roundedNum)}`;
    };
    const getTierBgColor = (tier) => {
        if (tier > 2.0) return '#52856A'; if (tier > 1.0) return '#44715A'; if (tier > 0) return '#375D4A';
        if (tier < -2.0) return '#7D4141'; if (tier < -1.0) return '#914E4E'; if (tier < 0) return '#A35B5B';
        return '#475569';
    };
    
    const reportData = driverData.isLocked ? driverData : getDriverReportData(driverData, settingsToUse);

    if (!driverData.isLocked) {
        if (driverData.hasOwnProperty('escrowDeduct')) reportData.escrowDeduct = driverData.escrowDeduct;
        if (driverData.hasOwnProperty('availableOffDays')) reportData.availableOffDays = driverData.availableOffDays;
    }

    const reportDate = driverData.pay_date.split('T')[0];

    const getSpeedingBarTiers = (settings) => {
        const method = settings.speedingPenaltyMethod || 'percentile';
        switch (method) {
            case 'range':
                const rangeTiers = (settings.speedingRangeTiers || []).map(t => t.penalty);
                return [...new Set([0, ...rangeTiers])].sort((a, b) => a - b);
            case 'perEvent':
                const penaltyPer = settings.speedingPerEventPenalty || 0;
                if (penaltyPer === 0) return [0];
                return [0, penaltyPer, penaltyPer * 2, penaltyPer * 3].sort((a, b) => a - b);
            case 'percentile':
            default:
                const percentileTiers = (settings.speedingPercentileTiers || []).map(t => t.bonus);
                return [...new Set([0, ...percentileTiers])].sort((a, b) => a - b);
        }
    };

    let performanceCards = [
        { title: 'Tenure', titleIcon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 002-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', value: reportData.bonuses?.['Tenure']?.bonus || 0, barTiers: [0, ...settingsToUse.tenureMilestones.map((_, i) => settingsToUse.tenureMilestones.slice(0, i + 1).reduce((sum, m) => sum + m.bonus, 0))], type: 'tenure' },
        { title: 'Weeks Out', titleIcon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z', value: reportData.bonuses?.['Weeks Out']?.bonus || 0, barTiers: [...new Set(settingsToUse.weeksOutTiers.map(t => t.bonus))].sort((a, b) => a - b), type: 'weeksOut' },
        { title: 'Gross Target', titleIcon: 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-.9.6-1.6 2.1-1.6 1.4 0 2.4.6 2.4 1.6H16c0-1.7-.9-3.2-3.1-3.6V4h-2v1.7c-2.1.4-3.5 2-3.5 3.9 0 2.2 1.8 3.3 4.5 3.9 2.5.6 3 1.2 3 2.1 0 .9-.6 1.6-2.1 1.6-1.6 0-2.6-.7-2.6-1.8H8c0 1.8 1.1 3.3 3.2 3.7V20h2v-1.7c2.2-.4 3.6-2 3.6-4 0-2.7-2.4-3.8-4.8-4.4z', value: reportData.bonuses?.['Gross Target']?.bonus || 0, barTiers: (settingsToUse.grossTargetTiers || []).sort((a, b) => a.from - b.from), type: 'grossTarget' },
        { title: 'Fuel Efficiency', titleIcon: 'M7 2h6a1 1 0 011 1v15a2 2 0 01-2 2H8a2 2 0 01-2-2V3a1 1 0 011-1zm10 4v12a2 2 0 002 2h1a1 1 0 001-1v-9a2 2 0 00-2-2h-2zM7 7h6', value: reportData.bonuses?.['Fuel Efficiency']?.bonus || 0, barTiers: [...new Set(settingsToUse.mpgPercentileTiers.map(t => t.bonus))].sort((a, b) => a - b), type: 'fuel' },
        { title: 'Speeding', titleIcon: 'M13 10V3L4 14h7v7l9-11h-7z', value: reportData.bonuses?.['Speeding Penalty']?.bonus || 0, barTiers: getSpeedingBarTiers(settingsToUse), type: 'speeding' },
        { title: 'Safety Score', titleIcon: 'M12 2L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3z', viewBox: '0 0 24 24', value: reportData.bonuses?.['Safety Score']?.bonus || 0, barTiers: [0, settingsToUse.safetyScoreBonus], type: 'safety' }
    ];

    performanceCards = performanceCards.filter(card => {
        let isEnabled;
        const metricsToUse = settingsToUse.enabledMetrics;
        if (driverData.isLocked && !metricsToUse) {
            if (card.type === 'tenure') isEnabled = reportData.bonuses?.['Tenure'] !== undefined;
            else if (card.type === 'weeksOut') isEnabled = reportData.bonuses?.['Weeks Out'] !== undefined;
            else if (card.type === 'fuel') isEnabled = reportData.bonuses?.['Fuel Efficiency'] !== undefined;
            else if (card.type === 'speeding') isEnabled = reportData.bonuses?.['Speeding Penalty'] !== undefined;
            else if (card.type === 'safety') isEnabled = reportData.bonuses?.['Safety Score'] !== undefined;
            else if (card.type === 'grossTarget') isEnabled = reportData.bonuses?.['Gross Target'] !== undefined;
            else isEnabled = true;
        } else if (metricsToUse) {
            if (card.type === 'tenure') isEnabled = metricsToUse.tenure;
            else if (card.type === 'weeksOut') isEnabled = metricsToUse.weeksOut;
            else if (card.type === 'fuel') isEnabled = metricsToUse.fuel;
            else if (card.type === 'speeding' || card.type === 'safety') isEnabled = metricsToUse.safety;
            else if (card.type === 'grossTarget') isEnabled = metricsToUse.grossTarget;
            else isEnabled = true;
        } else {
            isEnabled = true;
        }
        return isEnabled;
    });

    // Create a temporary canvas context to measure text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const width = 820;

    performanceCards.forEach(card => {
        if (!reportData.bonuses) { card.combinedText = "Data unavailable."; return; }
        let bonusKey;
        if (card.type === 'weeksOut') bonusKey = 'Weeks Out';
        else if (card.type === 'tenure') bonusKey = 'Tenure';
        else if (card.type === 'fuel') bonusKey = 'Fuel Efficiency';
        else if (card.type === 'grossTarget') bonusKey = 'Gross Target';
        else if (card.type === 'speeding') bonusKey = 'Speeding Penalty';
        else if (card.type === 'safety') bonusKey = 'Safety Score';
        const bonusData = reportData.bonuses[bonusKey];

        switch (card.type) {
             case 'tenure':
                const tenureBonus = reportData.bonuses['Tenure']?.bonus || 0;
                const sortedMilestones = [...(settingsToUse.tenureMilestones || [])].sort((a,b) => a.threshold - b.threshold);
                const nextTenure = sortedMilestones.find(m => m.threshold > driverData.tenure);
                if (tenureBonus > 0) { card.description = `Bonus for your ${driverData.tenure} weeks of loyalty.`; } else { card.description = `Currently at ${driverData.tenure} weeks, no bonus applied.`; }
                card.infoText = nextTenure ? `Next bonus milestone at ${nextTenure.threshold} weeks.` : 'Max tenure bonus reached.';
                break;
            case 'grossTarget':
                const gross = driverData.gross || 0;
                const grossBonus = reportData.bonuses['Gross Target']?.bonus || 0;
                if (driverData.grossOverrideNote) {
                    card.description = driverData.grossOverrideNote;
                    card.infoText = '';
                } else {
                    card.description = `You grossed $${gross.toFixed(0)} this week.`;
                    const sortedGrossTiers = (settingsToUse.grossTargetTiers || []).sort((a, b) => a.from - b.from);
                    const nextGrossTier = sortedGrossTiers.find(t => t.bonus > grossBonus);
                    if (nextGrossTier) { card.infoText = `Reach $${nextGrossTier.from} for a +${nextGrossTier.bonus.toFixed(1)}% bonus.`; } 
                    else { card.infoText = 'Maximum gross target bonus reached.'; }
                }
                break;
             case 'speeding': const speedingMethod = settingsToUse.speedingPenaltyMethod || 'percentile'; const numAlerts = driverData.speedingAlerts; const penaltyBonus = reportData.bonuses['Speeding Penalty']?.bonus || 0; switch (speedingMethod) { case 'perEvent': const minEvents = settingsToUse.speedingPerEventMinimum || 2; if (numAlerts < minEvents) { card.description = `${numAlerts} speeding ${numAlerts === 1 ? 'alert' : 'alerts'}. No penalty applied.`; card.infoText = `Stay below ${minEvents} alerts to avoid penalties.`; } else { const penaltyPer = settingsToUse.speedingPerEventPenalty || -1.0; const penalizedEvents = numAlerts - (minEvents - 1); card.description = `This week, ${penalizedEvents} of your ${numAlerts} alerts were penalized at ${penaltyPer}%.`; card.infoText = `To avoid deductions, keep alerts under ${minEvents}.`; } break; case 'range': if (penaltyBonus === 0) { card.description = `${numAlerts} speeding ${numAlerts === 1 ? 'alert' : 'alerts'}.`; card.infoText = 'Good job, no penalty applied for this range.'; } else { const sortedTiers = (settingsToUse.speedingRangeTiers || []).sort((a, b) => a.from - b.from); let activeTier = null; for (const tier of sortedTiers) { if (numAlerts >= tier.from && numAlerts <= (tier.to || Infinity)) { activeTier = tier; break; } } if (activeTier) { const toValue = activeTier.to; const rangeText = (toValue === null || typeof toValue === 'undefined' || toValue === Infinity) ? `${activeTier.from} or more` : `${activeTier.from}-${toValue}`; card.description = `To clear the penalty you got for ${numAlerts} alerts (${rangeText} tier), keep future alerts to 1 or fewer.`; card.infoText = ''; } else { card.description = `${numAlerts} speeding ${numAlerts === 1 ? 'alert' : 'alerts'}.`; card.infoText = 'No penalty applied for this range.'; } } break; case 'percentile': default: if (penaltyBonus === 0) { card.description = `${numAlerts} speeding ${numAlerts === 1 ? 'alert' : 'alerts'}.`; card.infoText = 'Good job, no speeding penalty applied.'; } else { card.description = `Your ${numAlerts} alerts mean you performed worse than ${driverData.speedingPercentile}% of drivers. To clear this penalty, keep future alerts to 1 or fewer.`; card.infoText = ''; } break; } break;
             case 'fuel':
                const currentMpg = parseFloat(driverData.mpg);
                const fuelBonus = reportData.bonuses['Fuel Efficiency']?.bonus || 0;
                if (fuelBonus >= 0) { card.description = `${currentMpg.toFixed(1)} MPG puts you better than ${driverData.mpgPercentile}% of drivers.`; } 
                else { card.description = `${currentMpg.toFixed(1)} MPG puts you worse than ${100 - driverData.mpgPercentile}% of drivers.`; }
                
                if (reportData.bonuses['Fuel Efficiency']?.infoText) {
                    card.infoText = reportData.bonuses['Fuel Efficiency'].infoText;
                } else {
                    const sortedTiers = [...settingsToUse.mpgPercentileTiers].sort((a, b) => a.threshold - b.threshold);
                    let targetTier = null;
                    if (fuelBonus < 0) { targetTier = sortedTiers.find(t => t.bonus >= 0); } 
                    else { targetTier = sortedTiers.find(t => t.bonus > fuelBonus); }
                    
                    if (targetTier) card.infoText = `Reach ${targetTier.threshold} percentile for next bonus.`;
                    else card.infoText = 'Maximum fuel bonus reached.';
                }
                card.combinedText = `${card.description} ${card.infoText}`;
                break;
             case 'safety': const bonusAwarded = (reportData.bonuses['Safety Score']?.bonus || 0) > 0; const scoreMet = driverData.safetyScore >= settingsToUse.safetyScoreThreshold; const milesMet = driverData.milesWeek >= settingsToUse.safetyScoreMileageThreshold; const hasSpeeding = driverData.speedingAlerts > 0; if (bonusAwarded) { card.description = 'Good score and miles requirement met.'; card.infoText = 'Bonus requirements met.'; } else if (!scoreMet) { card.description = `Score is ${driverData.safetyScore}%. Need ${settingsToUse.safetyScoreThreshold}% to qualify.`; card.infoText = `Improve score to earn the bonus.`; } else if (!milesMet) { card.description = `To qualify for the safety bonus, meet the ${settingsToUse.safetyScoreMileageThreshold} weekly miles criteria.`; card.infoText = `Drive more to unlock this bonus.`; } else if (hasSpeeding && settingsToUse.safetyBonusForfeitedOnSpeeding) { card.description = `Bonus forfeited due to ${driverData.speedingAlerts} speeding alert(s).`; card.infoText = `Needs 0 speeding alerts to unlock +${settingsToUse.safetyScoreBonus.toFixed(1)}%`; } else { card.description = 'Safety bonus not awarded this week.'; card.infoText = 'Check requirements for details.'; } break;
             case 'weeksOut':
                const weeksOutValue = driverData.weeksOut || 0;
                const weeksOutBonus = reportData.bonuses['Weeks Out']?.bonus || 0;
                const nextWeeksOutTier = settingsToUse.weeksOutTiers.find(t => t.bonus > weeksOutBonus);
                if (settingsToUse.weeksOutMethod === 'dailyAccrual') {
                    const totalDays = Math.round(weeksOutValue * 7);
                    const wholeWeeks = Math.floor(totalDays / 7);
                    const remainingDays = totalDays % 7;
                    let streakText = `${wholeWeeks} week${wholeWeeks !== 1 ? 's' : ''}`;
                    if (remainingDays > 0) streakText += ` and ${remainingDays} day${remainingDays !== 1 ? 's' : ''}`;
                    if (weeksOutBonus > 0) { card.description = `Bonus for your continuous streak of ${Math.floor(weeksOutValue)} weeks.`; } 
                    else { card.description = `Your current streak is ${streakText}.`; }
                    card.infoText = nextWeeksOutTier ? `Stay out for ${nextWeeksOutTier.threshold} weeks to earn a +${nextWeeksOutTier.bonus.toFixed(1)}% bonus.` : 'Max weeks out bonus reached.';
                } else {
                    card.description = weeksOutBonus > 0 ? `Bonus for ${weeksOutValue} consecutive weeks out.` : `Currently at ${weeksOutValue} weeks out, no bonus.`;
                    card.infoText = nextWeeksOutTier ? `Stay out for ${nextWeeksOutTier.threshold} weeks for a +${nextWeeksOutTier.bonus.toFixed(1)}% bonus.` : 'Max weeks out bonus reached.';
                }
                break;
        }

        if (bonusData && bonusData.ignored) {
            const potential = bonusData.potentialBonus || 0;
            let suffix = potential > 0 ? ' (no bonus applied)' : (potential < 0 ? ' (no penalty applied)' : '');
            card.infoText = ''; 
            card.description = (card.description || '') + suffix;
        }
        if (card.type === 'grossTarget') card.combinedText = card.description;
        else card.combinedText = card.combinedText || `${card.description} ${card.infoText}`;
    });

    const availableDays = reportData.availableOffDays; 
    const daysTaken = driverData.offDays || 0;
    const escrowDeduction = reportData.escrowDeduct;
    const escrowDeductionAmount = settingsToUse.escrowDeductionAmount || 1;
    const startAfterWeeks = settingsToUse.timeOffStartAfterWeeks || 3;

    let timeOffCard = { title: 'Down Time & Escrow', titleIcon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', description: '', value: escrowDeduction > 0 ? -escrowDeduction : 0, statusBarHtml: '' };
   
    if (daysTaken > availableDays) {
        const excessDays = daysTaken - availableDays;
        if (escrowDeduction > 0) { timeOffCard.description = `You used ${daysTaken} days, which is ${excessDays} more than your ${availableDays} earned days. Your escrow has been deducted.`; } 
        else { timeOffCard.description = `You used ${daysTaken} days off, which is more then your ${availableDays} earned days. Please track your balance, as deductions may apply in the future.`; }
    } else if (daysTaken > 0) {
        const remainingDays = availableDays - daysTaken;
        timeOffCard.description = `You have used ${daysTaken} of your ${availableDays} earned down time days. You have ${remainingDays} day(s) remaining.`;
    } else {
        const weeksOutVal = driverData.weeksOut || 0;
        if (weeksOutVal >= startAfterWeeks) {
             const weeksSinceLastDay = (weeksOutVal - startAfterWeeks) % (settingsToUse.timeOffWeeksPerDay || 1);
             const daysToNext = Math.ceil((1 - weeksSinceLastDay) * 7);
             timeOffCard.description = `You have ${availableDays} earned down time days. You earn another after ${daysToNext} more active day${daysToNext !== 1 ? 's' : ''}.`;
        } else {
            if (settingsToUse.weeksOutMethod === 'dailyAccrual') {
                 const daysNeeded = Math.ceil((startAfterWeeks - weeksOutVal) * 7);
                 const weeksNeeded = Math.floor(daysNeeded / 7);
                 const remainingDaysNeeded = daysNeeded % 7;
                 let neededText = `${weeksNeeded} week${weeksNeeded !== 1 ? 's' : ''}`;
                 if(remainingDaysNeeded > 0) neededText += ` and ${remainingDaysNeeded} day${remainingDaysNeeded !== 1 ? 's' : ''}`;
                 timeOffCard.description = `You need ${neededText} more to start earning free off days.`;
            } else { timeOffCard.description = `You need ${Math.ceil(startAfterWeeks - weeksOutVal)} more week(s) out to start earning free off days.`; }
        }
    }

    const timeOffCardYBase = 200 + performanceCards.length * 90;
    const timeOffCardY = timeOffCardYBase - 20;
    const descriptionY = timeOffCardY + 40 + 15;
    const height = descriptionY + 40;
    const statusBarY = timeOffCardYBase - 12;
    let dayBlocksHtml = '', outlineHtml = '';
    const greenShades = ['#375D4A', '#44715A', '#52856A', '#619A7B', '#70AC8D'];
    const redShades = ['#A35B5B', '#914E4E', '#7D4141', '#6A3434', '#582A2A'];

    const totalSlots = Math.max(availableDays, daysTaken);
    if (totalSlots > 0) {
        const blockWidth = (370 - (totalSlots - 1) * 4) / totalSlots;
        let currentX = 320;
        for (let i = 0; i < totalSlots; i++) {
            let color = (i < availableDays) ? greenShades[Math.min(i, greenShades.length - 1)] : redShades[Math.min(i - availableDays, redShades.length - 1)];
            dayBlocksHtml += `<g><rect x="${currentX}" y="${statusBarY}" width="${blockWidth}" height="24" fill="${color}" /><text x="${currentX + blockWidth / 2}" y="${statusBarY + 12}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="#e2e8f0">${i + 1}</text></g>`;
            currentX += blockWidth + 4;
        }
        if (daysTaken > 0) { const outlineWidth = (daysTaken * blockWidth) + ((daysTaken - 1) * 4); outlineHtml = `<rect x="318" y="${statusBarY - 2}" width="${outlineWidth + 4}" height="28" fill="none" stroke="#e2e8f0" stroke-width="1.5" />`; }
    } else {
        dayBlocksHtml = `<g><rect x="320" y="${statusBarY}" width="370" height="24" fill="#334155" /><text x="${320 + 370 / 2}" y="${statusBarY + 12}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="#cbd5e1">0 Days Available</text></g>`;
    }
    timeOffCard.statusBarHtml = dayBlocksHtml + outlineHtml;

    const totalBonuses = reportData.totalPositiveBonuses || 0;
    const totalPenalties = reportData.totalPenalties || 0;
    const finalTpog = reportData.totalTpog || settingsToUse.baseRate || 0;
    const brightGreenColor = '#74d99b', brightRedColor = '#c56060';

    const svg = `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: 'Inter', sans-serif;">
            <defs><radialGradient id="backgroundGradient" cx="50%" cy="0%" r="100%" fx="50%" fy="0%"><stop offset="0%" style="stop-color:#1e293b;" /><stop offset="100%" style="stop-color:#0f172a;" /></radialGradient></defs>
            <rect x="0" y="0" width="${width}" height="${height}" fill="url(#backgroundGradient)" />
            <text x="40" y="45" font-size="22" font-weight="600" fill="#60a5fa">${driverData.name}</text>
            <text x="${width - 40}" y="45" font-size="14" font-weight="400" fill="#94a3b8" text-anchor="end" dominant-baseline="middle">${reportDate}</text>
            <text x="37" y="110" dominant-baseline="middle" font-size="72" font-weight="900" fill="#e2b340" text-anchor="start"><tspan>${finalTpog.toFixed(1)}</tspan><tspan>%</tspan></text>
            <text x="320" y="85" dominant-baseline="middle" font-size="15" font-weight="600" fill="#e2e8f0">Base: +${formatNumber(settingsToUse.baseRate)}%</text>
            <text x="320" y="105" dominant-baseline="middle" font-size="15" font-weight="600" fill="${brightGreenColor}">Bonuses: +${formatNumber(totalBonuses)}%</text>
            <text x="320" y="125" dominant-baseline="middle" font-size="15" font-weight="600" fill="${brightRedColor}">Penalties: ${formatNumber(totalPenalties)}%</text>
            
            ${performanceCards.map((card, index) => {
                const y_base = 200 + index * 90;
                const card_height = 40;
                const card_y = y_base - card_height / 2;
                const valueDisplayColor = card.value > 0 ? brightGreenColor : card.value < 0 ? brightRedColor : '#e2e8f0';
                
                const barHtml = card.barTiers ? (() => {
                    let activeTierValue = card.value;
                    if (card.type === 'tenure') { activeTierValue = (settingsToUse.tenureMilestones || []).filter(m => driverData.tenure >= m.threshold).reduce((sum, m) => sum + m.bonus, 0); }
                    const isObjectTiers = card.barTiers.length > 0 && typeof card.barTiers[0] === 'object';
                    let closestTier;
                    if (isObjectTiers) { closestTier = card.barTiers.find(t => t.bonus === activeTierValue); } 
                    else { closestTier = card.barTiers.reduce((prev, curr) => (Math.abs(curr - activeTierValue) < Math.abs(prev - activeTierValue) ? curr : prev)); }
                    const numTiers = card.barTiers.length;
                    let segmentWidth = 370;
                    if (numTiers > 1) { segmentWidth = (370 - (4 * (numTiers - 1))) / numTiers; }
                    let currentX = 320;
                    let tiersHtml = '';
                    card.barTiers.forEach(tier => {
                        let isActive, bonusValue, textContent;
                        if (isObjectTiers) { isActive = tier === closestTier; bonusValue = tier.bonus; const bonusText = `${bonusValue > 0 ? '+' : ''}${formatNumber(bonusValue)}%`; textContent = `<text x="${currentX + segmentWidth / 2}" y="${y_base}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="${(bonusValue === 0) ? '#cbd5e1' : '#e2e8f0'}">${bonusText}</text>`; } 
                        else { isActive = tier === closestTier; bonusValue = tier; textContent = `<text x="${currentX + segmentWidth / 2}" y="${y_base}" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="600" fill="${(bonusValue === 0) ? '#cbd5e1' : '#e2e8f0'}">${bonusValue > 0 ? '+' : ''}${formatNumber(bonusValue)}%</text>`; }
                        tiersHtml += `<g>${isActive ? `<rect x="${currentX - 2}" y="${y_base - 14}" width="${segmentWidth + 4}" height="28" fill="none" stroke="#e2e8f0" stroke-width="1.5" />` : ''}<rect x="${currentX}" y="${y_base - 12}" width="${segmentWidth}" height="24" fill="${getTierBgColor(bonusValue)}" />${textContent}</g>`;
                        currentX += segmentWidth + 4;
                    });
                    return tiersHtml;
                })() : '';
                let barLabelsHtml = '';
                if (card.type === 'grossTarget' && card.barTiers) {
                    const numTiers = card.barTiers.length;
                    let segmentWidth = 370;
                    if (numTiers > 1) { segmentWidth = (370 - (4 * (numTiers - 1))) / numTiers; }
                    let currentX = 320;
                    card.barTiers.forEach(tier => { const fromText = `$${tier.from}`; barLabelsHtml += `<text x="${currentX + segmentWidth / 2}" y="${y_base + 25}" dominant-baseline="middle" text-anchor="middle" font-size="9" font-weight="400" fill="#94a3b8" font-style="italic">${fromText}</text>`; currentX += segmentWidth + 4; });
                }
                
                context.font = '400 10px Inter'; 
                const words = String(card.combinedText || '').split(' '); 
                let currentLine = words[0]; 
                const lines = []; 
                for (let i = 1; i < words.length; i++) { const testLine = `${currentLine} ${words[i]}`; if (context.measureText(testLine).width > (width - 80)) { lines.push(currentLine); currentLine = words[i]; } else { currentLine = testLine; } } 
                lines.push(currentLine); 
                const descriptionHtml = lines.map((line, i) => `<tspan x="60" dy="${i === 0 ? 0 : '1.4em'}">${line}</tspan>`).join('');

                return `<g><rect x="40" y="${card_y}" width="${width - 80}" height="${card_height}" fill="#1e293b" fill-opacity="0.5" /><g transform="translate(55, ${y_base})"><path d="${card.titleIcon}" stroke="#94a3b8" stroke-width="1.5" fill="none" transform="scale(0.8) translate(0, -14)"/><text x="26" y="0" dominant-baseline="middle" font-size="15" font-weight="600" fill="#ffffff">${card.title}</text></g>${barHtml}<text x="${width - 55}" y="${y_base}" dominant-baseline="middle" font-size="18" font-weight="700" fill="${valueDisplayColor}" text-anchor="end">${card.value > 0 ? '+' : ''}${formatNumber(card.value)}%</text><text y="${card_y + card_height + 15}" font-size="10" fill="#60a5fa" dominant-baseline="middle">${descriptionHtml}</text>${barLabelsHtml}</g>`;
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
    return svg;
}

/**
 * Downloads the driver report as a PNG.
 */
export function downloadDriverReport(driverData, settings, driversForDate) {
    const svg = generateReportSVG(driverData, settings, driversForDate);
    const captureContainer = document.createElement('div');
    captureContainer.style.position = 'absolute';
    captureContainer.style.left = '-9999px';
    captureContainer.style.width = '820px';
    captureContainer.style.fontFamily = "'Inter', sans-serif";
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
 * Shows the driver report in a modal popup.
 */
export function viewDriverReport(driverData, settings, driversForDate) {
    const svg = generateReportSVG(driverData, settings, driversForDate);
    const modal = document.getElementById('report-preview-modal');
    const content = document.getElementById('report-preview-content');
    content.innerHTML = svg;
    modal.classList.remove('hidden');
}

/**
 * Closes the report preview modal.
 */
export function closeReportModal() {
    document.getElementById('report-preview-modal').classList.add('hidden');
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
    const activeOverride = (isNew ? null : driver.isLocked) ? driver.distanceSource : overriddenDistances[overrideKey];
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
    
    const fieldsToExclude = ['id', 'name', 'totalTpog', 'actions', 'contract_type', 'dispatcher', 'team', 'franchise', 'company', 'rpm', 'estimatedNet', 'bonuses', 'penalties', 'speeding_over11mph', 'speeding_over16mph', 'samsaraDistance', 'availableOffDays', 'escrowDeduct', 'offDays'];

    const orderedKeys = [
        'tenure',
        'gross',
        'safetyScore',
        'stubMiles', // ADDED: stubMiles to the ordered keys array
        'speedingAlerts',
        'speedingPercentile',
        distanceKey,
        'mpg',
        'mpgPercentile',
        'weeksOut'
    ];

    const createFieldHTML = (key, val) => {
        const config = columnConfig[key] || { title: 'Distance', type: 'number' };
        // FIX: The title for stubMiles and safetyScore are manually set here to provide better context.
        const titleMap = {
            'stubMiles': 'Stub Miles',
            'safetyScore': 'Safety Score (%)',
            'speedingAlerts': 'Speeding Alerts',
            'mpg': 'MPG',
            'mpgPercentile': 'MPG Percentile (%)'
        };
        const title = titleMap[key] || config.title;
        const inputType = (config.type === 'number' || config.type === 'percent' || key === 'stubMiles') ? 'number' : 'text';
        return `<div><label class="block text-sm font-medium text-slate-400 mb-1">${title}</label><input type="${inputType}" id="edit-${key}" class="edit-input" value="${val}"></div>`;
    };

    let formFieldsHtml = orderedKeys.map(key => {
        let value = isNew ? '0' : driver[key];
        if (key === 'mpg') value = originalMpg;
        if (key === 'mpgPercentile') value = originalMpgPercentile;
        if (key === distanceKey) value = distanceValue;
        if (key === 'weeksOut' && settings.weeksOutMethod === 'dailyAccrual') {
            const numericValue = parseFloat(value);
            value = isNaN(numericValue) ? '0.0' : numericValue.toFixed(1);
        }
        return createFieldHTML(key, value);
    }).join('');

    const timeOffFieldsHtml = `
        <div><label class="block text-sm font-medium text-slate-400 mb-1">Available Days Off</label><input type="number" id="edit-availableOffDays" class="edit-input" value="${reportData.availableOffDays}"></div>
        <div><label class="block text-sm font-medium text-slate-400 mb-1">Days Taken</label><input type="number" id="edit-offDays" class="edit-input" value="${driver.offDays || 0}"></div>
        <div><label class="block text-sm font-medium text-slate-400 mb-1">Escrow Deduct</label><input type="number" id="edit-escrowDeduct" class="edit-input" value="${reportData.escrowDeduct}"></div>
    `;

    // --- METRIC EXCLUSIONS SECTION ---
    const isTrue = (val) => val === true || val === 'true';
    
    const exclusionFieldsHtml = `
        <div class="mt-2 border-t border-slate-700 pt-4 space-y-4">
            <h3 class="text-sm font-bold text-slate-300">Metric Exclusions</h3>
            
            <div class="flex items-center justify-between bg-slate-800 p-2 rounded border border-slate-600">
                <label class="text-sm font-bold text-white" for="edit-ignoreAll">Ignore EVERYTHING (Base Rate Only)</label>
                <input type="checkbox" id="edit-ignoreAll" class="edit-input h-5 w-5 rounded border-slate-500 bg-slate-700 text-red-500 focus:ring-red-500" style="width: auto;" ${isTrue(driver.ignoreAll) ? 'checked' : ''}>
            </div>

            <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                <div class="flex items-center justify-between">
                    <label class="text-xs text-slate-400" for="edit-ignoreWeeksOut">Ignore Weeks Out</label>
                    <input type="checkbox" id="edit-ignoreWeeksOut" class="edit-input h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-600" style="width: auto;" ${isTrue(driver.ignoreWeeksOut) ? 'checked' : ''}>
                </div>
                <div class="flex items-center justify-between">
                    <label class="text-xs text-slate-400" for="edit-ignoreSafety">Ignore Safety</label>
                    <input type="checkbox" id="edit-ignoreSafety" class="edit-input h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-600" style="width: auto;" ${isTrue(driver.ignoreSafety) ? 'checked' : ''}>
                </div>
                <div class="flex items-center justify-between">
                    <label class="text-xs text-slate-400" for="edit-ignoreFuel">Ignore Fuel</label>
                    <input type="checkbox" id="edit-ignoreFuel" class="edit-input h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-600" style="width: auto;" ${isTrue(driver.ignoreFuel) ? 'checked' : ''}>
                </div>
                <div class="flex items-center justify-between">
                    <label class="text-xs text-slate-400" for="edit-ignoreTenure">Ignore Tenure</label>
                    <input type="checkbox" id="edit-ignoreTenure" class="edit-input h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-600" style="width: auto;" ${isTrue(driver.ignoreTenure) ? 'checked' : ''}>
                </div>
                <div class="flex items-center justify-between">
                    <label class="text-xs text-slate-400" for="edit-ignoreGrossBonus">Ignore Gross</label>
                    <input type="checkbox" id="edit-ignoreGrossBonus" class="edit-input h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-600" style="width: auto;" ${isTrue(driver.ignoreGrossBonus) ? 'checked' : ''}>
                </div>
            </div>

            <div>
                <label class="block text-sm font-medium text-slate-400 mb-1">Override Note (Optional)</label>
                <input type="text" id="edit-grossOverrideNote" class="edit-input" value="${driver.grossOverrideNote || ''}" placeholder="Reason for changes (appears on report)...">
            </div>
        </div>
    `;

    editContent.innerHTML = `<div class="grid grid-cols-1 gap-4">${formHtml}${formFieldsHtml}${timeOffFieldsHtml}${exclusionFieldsHtml}</div>`;

    const editFooter = document.querySelector('#edit-panel footer');
    if (isNew) {
        editFooter.innerHTML = `
            <div class="flex justify-end w-full">
                <button id="download-manual-report-btn" class="bg-blue-600 text-white font-bold py-2 px-5 rounded-lg hover:bg-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-blue-500">
                    Download Report
                </button>
            </div>
        `;
    } else {
        editFooter.innerHTML = `
            <button id="return-to-default-btn" class="flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-red-400 transition-colors px-4 py-2 rounded-lg hover:bg-red-500/10">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Revert Changes
            </button>
            <div class="relative inline-flex shadow-md rounded-lg split-button-container">
                <button id="save-to-table-btn" class="bg-blue-600 text-white font-bold py-2 px-5 rounded-l-lg hover:bg-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-blue-500">
                    Save
                </button>
                <button id="split-button-chevron" class="bg-blue-700 text-white px-2 rounded-r-lg hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-blue-500">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
                <div id="split-button-dropdown" class="hidden absolute right-0 bottom-full mb-2 w-56 bg-slate-700 rounded-lg shadow-xl border border-slate-600 py-1 z-10">
                    <a href="#" id="dropdown-save-and-download" class="flex items-center gap-3 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                        Save and Download
                    </a>
                    <a href="#" id="dropdown-download" class="flex items-center gap-3 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600">
                       <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Download Only
                    </a>
                </div>
            </div>
        `;
    }

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

export function openActivityHistoryModal(driver, mileageData, settings, daysTakenHistory, dispatcherOverrides, allLockedData = {}, allWeeklyNotes = {}) {
    const modal = document.getElementById('activity-history-modal');
    const content = document.getElementById('activity-history-content');
    document.getElementById('activity-history-driver-name').textContent = driver.name;

    content.innerHTML = '<p class="text-slate-500 text-center py-10">Loading history...</p>';
    modal.classList.remove('hidden');

    // --- START: Comprehensive Data Collection ---
    // 1. Get mileage, changelog, and override records for the specific driver.
    const driverMileageRecords = mileageData.filter(m => m.driver_name === driver.name);
    const driverChangelog = daysTakenHistory.filter(h => h.driver_name === driver.name);
    const driverOverrideDates = Object.keys(dispatcherOverrides)
        .filter(key => key.startsWith(`${driver.name}_`))
        .map(key => new Date(key.split('_')[1]));

    // 2. Combine all dates from all sources into a single array.
    const allRecordDates = [
        ...driverMileageRecords.map(d => new Date(d.date)),
        ...driverChangelog.map(d => new Date(d.date)),
        ...driverOverrideDates
    ];

    // 3. If there's no data from any source, show a message and exit.
    if (allRecordDates.length === 0) {
        content.innerHTML = '<p class="text-slate-500 text-center py-10">No activity history found for this driver.</p>';
        return;
    }
    // --- END: Comprehensive Data Collection ---

    // 4. Find the earliest date the driver ever appears in any system.
    const driverFirstAppearance = new Date(Math.min(...allRecordDates));

    const formatDate = (date) => date.toISOString().split('T')[0];
    let historyHtml = '';
    // *** FIX 1: Ensure mileage is a number ***
    const driverMileageMap = new Map(driverMileageRecords.map(m => [m.date, parseFloat(m.movement) || 0]));

    // --- PRE-CALCULATE LOCKS BY NAME ---
    // Build a lookup map using Name + Date. This ensures we find historical locks
    // even if the driver's ID changed (e.g., switched companies/contracts).
    const driverLocksByDate = {};
    if (allLockedData) {
        Object.values(allLockedData).forEach(jsonStr => {
            // Optimization: Only parse if the string likely contains this driver
            if (jsonStr.includes(driver.name)) { 
                try {
                    const snapshot = JSON.parse(jsonStr);
                    // Verify strict name match and valid date
                    if (snapshot.name === driver.name && snapshot.pay_date) {
                        const dateKey = snapshot.pay_date.split('T')[0];
                        driverLocksByDate[dateKey] = snapshot;
                    }
                } catch (e) { /* Ignore parsing errors */ }
            }
        });
    }

    // --- START: Dynamic Loop Logic ---
    // 5. Loop dynamically without a fixed limit.
    let weekIndex = 0;
    while (true) {
        const payDate = new Date(driver.pay_date);
    
        const dayOfWeek = payDate.getUTCDay();
        const daysToSubtract = (dayOfWeek + 6) % 7;
        const baseMonday = new Date(payDate);
        baseMonday.setUTCDate(payDate.getUTCDate() - daysToSubtract);
    
        // Calculate the Monday for the current historical week
        const monday = new Date(baseMonday);
        monday.setUTCDate(baseMonday.getUTCDate() - (weekIndex * 7));

        // 6. Stop looping if the current week is before the driver's first appearance.
        if (monday < driverFirstAppearance) {
            break;
        }

        const currentPayDate = new Date(payDate);
        currentPayDate.setUTCDate(payDate.getUTCDate() - (weekIndex * 7));
        const currentPayDateStr = currentPayDate.toISOString().split('T')[0];
        
        // --- UPDATED: Look up lock by DATE (using the Name-based map) ---
        let lockedWeeklyActivity = null;
        let isFullyConfirmed = true; 
        let isLocked = false;
        let lockedSnapshot = null; 

        if (driverLocksByDate[currentPayDateStr]) {
            lockedSnapshot = driverLocksByDate[currentPayDateStr];
            if (lockedSnapshot.weeklyActivity) {
                lockedWeeklyActivity = lockedSnapshot.weeklyActivity;
                isLocked = true;
                isFullyConfirmed = true;
            }
        }
        // ---------------------------------------------------------------

        // --- Generate Stats HTML if Locked ---
        let statsSegment = '';
        let contractInfoHtml = ''; // New variable for Company/Contract

        if (isLocked && lockedSnapshot) {
            const tpog = lockedSnapshot.totalTpog ? lockedSnapshot.totalTpog.toFixed(1) + '%' : '0.0%';
            const gross = lockedSnapshot.gross ? '$' + Math.round(lockedSnapshot.gross).toLocaleString() : '$0';
            const miles = lockedSnapshot.stubMiles ? Math.round(lockedSnapshot.stubMiles).toLocaleString() : '0';
            const escrowVal = parseFloat(lockedSnapshot.escrowDeduct || 0);
            const escrowDisplay = escrowVal > 0 ? `-$${escrowVal.toFixed(0)}` : '-';
            const escrowColor = escrowVal > 0 ? 'text-red-400' : 'text-slate-500';

            // New: Extract Contract and Company info
            const contract = lockedSnapshot.contract_type || 'Unknown';
            const company = lockedSnapshot.company || 'Unknown';
            contractInfoHtml = `<span class="ml-2 text-[9px] font-bold text-slate-400 border border-slate-600 px-1 rounded uppercase tracking-wider" title="Contract & Company">${contract} • ${company}</span>`;

            statsSegment = `
                <div class="flex flex-wrap items-center text-[11px] sm:text-xs text-slate-400 mt-1 sm:mt-0 sm:ml-auto mr-4">
                    <span class="hidden sm:inline text-slate-600 mx-2">|</span>
                    <span class="mr-1">Gross:</span> <span class="text-slate-200 font-medium mr-3">${gross}</span>
                    <span class="mr-1">Miles:</span> <span class="text-slate-200 font-medium mr-3">${miles}</span>
                    <span class="mr-1">Escrow:</span> <span class="${escrowColor} font-medium mr-3">${escrowDisplay}</span>
                    <span class="mr-1">Pay:</span> <span class="text-yellow-500 font-bold">${tpog}</span>
                </div>
            `;
        }

        const tuesday = new Date(monday);
        tuesday.setUTCDate(monday.getUTCDate() - 6);

        let weeklyActivityData = [];
        
        if (isLocked && lockedWeeklyActivity) {
            // --- USE SNAPSHOT DATA ---
            weeklyActivityData = lockedWeeklyActivity;
        } else {
            // --- USE LIVE CALCULATION ---
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

                const statusesForDay = driverChangelog
                    .filter(log => new Date(log.date).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) === currentDay.toLocaleDateString('en-US', { timeZone: 'America/Chicago' }))
                    .map(log => log.activity_status);
                const uniqueStatuses = [...new Set(statusesForDay)];
                const systemStatusText = uniqueStatuses.length > 0 ? uniqueStatuses.join(', ') : 'No Data';
                
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

            // Check confirmation status for live data
            for (let j = 0; j < 7; j++) {
                const currentDay = new Date(tuesday);
                currentDay.setUTCDate(tuesday.getUTCDate() + j);
                const dayString = formatDate(currentDay);
                const overrideKey = `${driver.name}_${dayString}`;
                if (!dispatcherOverrides[overrideKey]) {
                    isFullyConfirmed = false;
                    break;
                }
            }
        }
        
        const checkmarkHtml = isFullyConfirmed ?
            `<div class="tooltip-container" data-tooltip="Reviewed by Dispatcher">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
            </div>` : '';
        
        // This variable will hold the HTML for the 7 day blocks
        let activityBlocksHtml = '';

        weeklyActivityData.forEach(activity => {
            let colorClass = 'activity-red'; // Default to red
            const statuses = (activity.statuses || '').toUpperCase();

            // --- UPDATED COLOR LOGIC ---
            if (statuses.includes('NOT_STARTED') || statuses.includes('CONTRACT_ENDED')) {
                colorClass = 'activity-grey';
            } else if (statuses.includes('DAY_OFF')) {
                colorClass = 'activity-red';
            } else if (statuses.includes('WITHOUT_LOAD')) {
                colorClass = 'activity-orange';
            } else if (statuses.includes('ACTIVE')) {
                colorClass = 'activity-green';
            } else if (activity.mileage > 0) {
                colorClass = 'activity-green';
            } else if (statuses.includes('NO DATA')) {
                colorClass = 'activity-grey';
            } else {
                colorClass = 'activity-red';
            }

            const miles = (parseFloat(activity.mileage) || 0).toFixed(0);
            const mileLabel = miles === "1" ? "mile" : "mi";
            let tooltipText = `${activity.fullDate} - ${miles} ${mileLabel}. Status: ${activity.statuses}`;
            if (activity.isChanged) {
                tooltipText = `${activity.fullDate} - ${miles} ${mileLabel}. Status: ${activity.tooltipStatus}`;
            }

            // Overlay class removed

            activityBlocksHtml += `<div class="tooltip-container" data-tooltip="${tooltipText}">
                                    <div class="weekly-activity-block ${colorClass}">${activity.day}</div>
                                </div>`;
        });

        // --- 1. Note Icon Logic ---
        // Try to get note from Snapshot (if locked) OR Global Cache (if unlocked)
        let noteContent = '';
        if (isLocked && lockedSnapshot && lockedSnapshot.weeklyNote) {
            noteContent = lockedSnapshot.weeklyNote;
        } else {
            // Reconstruct the key: DriverName_YYYY-MM-DD
            const noteKey = `${driver.name}_${currentPayDateStr}`;
            if (allWeeklyNotes[noteKey]) {
                noteContent = allWeeklyNotes[noteKey];
            }
        }

        let noteIconHtml = '';
        if (noteContent) {
            const escapedNote = noteContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            noteIconHtml = `
                <div class="tooltip-container ml-2 cursor-help" data-tooltip="${escapedNote}">
                    <svg class="w-4 h-4 text-indigo-300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
                    </svg>
                </div>`;
        }

        // --- 3. Render Week Card (Single Row Layout) ---
        let weekHtml = `
            <div class="mb-3 bg-slate-800 rounded-lg border border-slate-700/50 shadow-sm overflow-hidden">
                <div class="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-900/40 border-b border-slate-700/50">
                    <div class="flex items-center flex-grow">
                        <span class="text-xs font-semibold text-slate-200 whitespace-nowrap">${formatDate(tuesday)} to ${formatDate(monday)}</span>
                        ${isLocked ? '<span class="ml-2 text-[9px] font-bold text-blue-400 border border-blue-400 px-1 rounded uppercase tracking-wider">Locked</span>' : ''}
                        ${contractInfoHtml} 
                        ${noteIconHtml}
                        ${statsSegment}
                    </div>
                    ${checkmarkHtml}
                </div>
                
                <div class="flex items-center justify-center p-2">
                    <div class="flex items-center gap-1">
                        ${activityBlocksHtml}
                    </div>
                </div>
            </div>`;
        
        historyHtml += weekHtml;

        weekIndex++; // Move to the previous week
        // 7. Add a safety break to prevent infinite loops (e.g., 5 years of history).
        if (weekIndex > 260) {
            console.warn("Weekly activity history loop stopped after 5 years to prevent infinite loop.");
            break;
        }
    }
    // --- END: Dynamic Loop Logic ---

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
    const tableBody = document.getElementById('safety-table-body');

    if (!data || data.length === 0) {
        // If there's no data, clear the container and show a message
        container.innerHTML = `<p class="text-slate-500 text-center py-10">No safety history found for this driver.</p>`;
        // Destroy any lingering chart if the data disappears
        if (safetyChart) {
            safetyChart.destroy();
            safetyChart = null;
        }
        return;
    }

    // If the "no data" message was shown before, we need to restore the structure
    if (!tableBody) {
         container.innerHTML = `
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
                    <tbody id="safety-table-body"></tbody>
                </table>
            </div>
            <div class="chart-container">
                <canvas id="safety-history-chart"></canvas>
            </div>`;
    }
    
    // Re-select the table body in case it was just recreated
    const tableBodyToUpdate = document.getElementById('safety-table-body');

    // Sort the data by date in ascending order (A to Z) before rendering
    const sortedData = data.sort((a, b) => new Date(a.date) - new Date(b.date));

    tableBodyToUpdate.innerHTML = sortedData.map(row => {
        const date = new Date(row.date);
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
    }).join('');
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
        // --- GROUPED VIEW LOGIC (Unchanged) ---
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
        
        // --- ANALYSIS BLOCK REMOVED ---

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
    renderSafetyChart(safetyData); // Add this line
    renderPOTable(poData);
    renderFuelTable(fullHistoryData, unmatchedPurchases, groupToggle.checked);

    const rerenderFuelView = () => {
        filterAndRenderHistory(daysFilter.value, unmatchedPurchases);
    };

    daysFilter.onchange = rerenderFuelView;
    groupToggle.onchange = rerenderFuelView;

    // --- NEW: Combined Click Listener ---
    historyModalClickListener = (e) => {
        
        // 1. Handle Accordion Click
        const header = e.target.closest('.fuel-analysis-header');
        if (header) {
            const content = header.nextElementSibling;
            const chevron = header.querySelector('.fuel-analysis-chevron');
            if (content) {
                content.classList.toggle('hidden');
            }
            if (chevron) {
                chevron.classList.toggle('rotate-180');
            }
            return; // Stop processing
        }
        
        // 2. Handle Table Row Click (Original Logic)
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

/** Shows the in-place processing overlay. */
export function showLoadingOverlay() {
    const processingOverlay = document.getElementById('processing-overlay');
    if (processingOverlay) {
        processingOverlay.classList.remove('hidden');
    }
}

/** Hides the in-place processing overlay. */
export function hideLoadingOverlay() {
    const processingOverlay = document.getElementById('processing-overlay');
    if (processingOverlay) {
        // No timeout needed here anymore, the transition is handled by CSS.
        processingOverlay.classList.add('hidden');
    }
}

const modalOverlay = document.getElementById('custom-modal-overlay');
const modalTitle = document.getElementById('custom-modal-title');
const modalMessage = document.getElementById('custom-modal-message');
const modalConfirmBtn = document.getElementById('custom-modal-btn-confirm');
const modalCancelBtn = document.getElementById('custom-modal-btn-cancel');
const modalCloseBtn = document.getElementById('custom-modal-close-btn');

let modalResolve = null;

function closeModal() {
    modalOverlay.classList.add('hidden');
    if (modalResolve) {
        modalResolve(false); // Default to 'false' if closed without choice
        modalResolve = null;
    }
}

modalConfirmBtn.addEventListener('click', () => {
    if (modalResolve) {
        modalResolve(true);
        modalResolve = null;
    }
    modalOverlay.classList.add('hidden');
});

modalCancelBtn.addEventListener('click', closeModal);
modalCloseBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
        closeModal();
    }
});

/**
 * Shows a custom-styled alert message.
 * @param {string} message The message to display.
 * @param {string} [title='Alert'] Optional title.
 */
export function showCustomAlert(message, title = 'Alert') {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    
    // Configure for Alert (only OK button)
    modalConfirmBtn.textContent = 'OK';
    modalConfirmBtn.classList.remove('modal-btn-danger');
    modalCancelBtn.classList.add('hidden');
    
    modalOverlay.classList.remove('hidden');
}

/**
 * Shows a custom-styled confirmation dialog.
 * @param {string} title The title of the modal.
 * @param {string} message The confirmation message.
 * @param {Object} [options] Optional settings.
 * @param {string} [options.confirmText='OK'] Text for the confirm button.
 * @param {string} [options.cancelText='Cancel'] Text for the cancel button.
 * @param {boolean} [options.isDanger=false] If true, makes the confirm button red.
 * @returns {Promise<boolean>} Resolves true if confirmed, false if canceled.
 */
export function showCustomConfirm(title, message, options = {}) {
    const { confirmText = 'OK', cancelText = 'Cancel', isDanger = false } = options;
    
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    
    // Configure for Confirm (both buttons)
    modalConfirmBtn.textContent = confirmText;
    modalCancelBtn.textContent = cancelText;
    modalCancelBtn.classList.remove('hidden');
    
    if (isDanger) {
        modalConfirmBtn.classList.add('modal-btn-danger');
    } else {
        modalConfirmBtn.classList.remove('modal-btn-danger');
    }
    
    modalOverlay.classList.remove('hidden');
    
    return new Promise((resolve) => {
        modalResolve = resolve;
    });
}
