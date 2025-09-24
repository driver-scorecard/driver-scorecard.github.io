/**
 * calculations.js
 * * Contains all the core business logic for calculating bonuses, penalties,
 * percentiles, and the final TPOG score.
 */

/**
 * Finds the highest applicable bonus from a set of tiers.
 * @param {number} value The driver's metric value (e.g., MPG percentile).
 * @param {Array<Object>} tiers The array of tiers, each with a 'threshold' and 'bonus'.
 * @returns {{bonus: number, metThreshold: number|null}} The calculated bonus and the threshold that was met.
 */
export const getTieredBonusDetails = (value, tiers) => {
    let bonus = 0;
    let metThreshold = null;
    if (!tiers || !Array.isArray(tiers)) return { bonus, metThreshold };
    const applicableTiers = tiers.filter(tier => value >= tier.threshold);
    if (applicableTiers.length > 0) {
        const bestTier = applicableTiers.reduce((max, current) => current.threshold > max.threshold ? current : max);
        bonus = bestTier.bonus;
        metThreshold = bestTier.threshold;
    }
    return { bonus, metThreshold };
};

/**
 * Calculates a complete TPOG report for a single driver.
 * @param {Object} driver The driver object.
 * @param {Object} settings The application settings object.
 * @returns {Object} A report containing bonus details and the final TPOG score.
 */
export function getDriverReportData(driver, settings) {
    const report = { totalBonus: 0, totalPenalties: 0, bonuses: {}, totalTpog: 0, availableOffDays: 0, escrowDeduct: 0 };

    // Weeks Out Bonus
    const weeksOutDetails = getTieredBonusDetails(driver.weeksOut, settings.weeksOutTiers);
    report.bonuses['Weeks Out'] = { bonus: weeksOutDetails.bonus };
    report.totalBonus += weeksOutDetails.bonus;

    // Safety Score Bonus
    let safetyBonus = 0;
    const scoreMet = driver.safetyScore >= settings.safetyScoreThreshold;
    const milesMet = driver.milesWeek >= settings.safetyScoreMileageThreshold;
    const hasSpeedingAlerts = driver.speedingAlerts > 0;
    if (settings.safetyBonusForfeitedOnSpeeding && hasSpeedingAlerts && scoreMet && milesMet) {
        safetyBonus = 0;
    } else if (scoreMet && milesMet) {
        safetyBonus = settings.safetyScoreBonus;
    }
    report.bonuses['Safety Score'] = { bonus: safetyBonus };
    report.totalBonus += safetyBonus;

    // Speeding Penalty
    let speedingPenalty = 0;
    const method = settings.speedingPenaltyMethod || 'percentile';

    switch (method) {
        case 'percentile':
            if (driver.speedingAlerts >= 2) {
                const penaltyDetails = getTieredBonusDetails(driver.speedingPercentile, settings.speedingPercentileTiers);
                speedingPenalty = penaltyDetails.bonus;
            }
            break;
        case 'perEvent':
            const minEvents = settings.speedingPerEventMinimum || 2;
            if (driver.speedingAlerts >= minEvents) {
                const penaltyPer = settings.speedingPerEventPenalty || -1.0;
                const penalizedEvents = driver.speedingAlerts - (minEvents - 1);
                speedingPenalty = penalizedEvents * penaltyPer;
            }
            break;
        case 'range':
            const sortedTiers = (settings.speedingRangeTiers || []).sort((a, b) => a.from - b.from);
            for (const tier of sortedTiers) {
                const from = tier.from;
                const to = tier.to || Infinity;
                if (driver.speedingAlerts >= from && driver.speedingAlerts <= to) {
                    speedingPenalty = tier.penalty;
                    break;
                }
            }
            break;
    }
    report.bonuses['Speeding Penalty'] = { bonus: speedingPenalty };
    report.totalBonus += speedingPenalty;

    // Fuel Efficiency Bonus
    const percentileDetails = getTieredBonusDetails(driver.mpgPercentile, settings.mpgPercentileTiers);
    report.bonuses['Fuel Efficiency'] = { bonus: percentileDetails.bonus };
    report.totalBonus += percentileDetails.bonus;

    // Tenure Bonus
    let tenureBonus = 0;
    if (settings.tenureMilestones && Array.isArray(settings.tenureMilestones)) {
        settings.tenureMilestones.forEach(milestone => {
            if (driver.tenure >= milestone.threshold) {
                tenureBonus += milestone.bonus;
            }
        });
    }
    report.bonuses['Tenure'] = { bonus: tenureBonus };
    report.totalBonus += tenureBonus;

    // Separate Bonuses and Penalties
    report.totalPositiveBonuses = Object.values(report.bonuses).reduce((sum, { bonus }) => sum + Math.max(0, bonus), 0);
    report.totalPenalties = Object.values(report.bonuses).reduce((sum, { bonus }) => sum + Math.min(0, bonus), 0);

    // **NEW: Running Balance for Off Days and Escrow**
    const weeksOut = driver.weeksOut || 0;
    const baseDays = (settings && typeof settings.timeOffBaseDays === 'number') ? settings.timeOffBaseDays : 3;
    const startAfterWeeks = (settings && typeof settings.timeOffStartAfterWeeks === 'number') ? settings.timeOffStartAfterWeeks : 3;
    const weeksPerDay = (settings && typeof settings.timeOffWeeksPerDay === 'number' && settings.timeOffWeeksPerDay > 0) ? settings.timeOffWeeksPerDay : 1;
    
    let totalEarnedDays = 0;
    if (weeksOut >= startAfterWeeks) {
        const weeksSinceQualified = weeksOut - startAfterWeeks;
        const additionalDays = Math.floor(weeksSinceQualified / weeksPerDay);
        totalEarnedDays = baseDays + additionalDays;
    }

    const availableDaysBalance = totalEarnedDays - (driver.totalDaysTakenPreviously || 0);
    report.availableOffDays = availableDaysBalance;

    const daysTakenThisWeek = driver.offDays || 0; 
    let excessDays = 0;

    // If the driver has a positive or zero balance of days off, excess days are any taken this week beyond that balance.
    // If the balance is already negative, any day taken this week is considered an excess day.
    if (availableDaysBalance >= 0) {
        excessDays = Math.max(0, daysTakenThisWeek - availableDaysBalance);
    } else {
        excessDays = daysTakenThisWeek;
    }
    
    report.escrowDeduct = excessDays * (settings.escrowDeductionAmount || 0);
    
    // Final TPOG
    report.totalTpog = settings.baseRate + report.totalBonus;
    return report;
}

/**
 * Calculates just the final TPOG score for a driver.
 * @param {Object} driver The driver object.
 * @param {Object} settings The application settings object.
 * @returns {number} The final TPOG score.
 */
export function calculateDriverTPOG(driver, settings) {
    return getDriverReportData(driver, settings).totalTpog;
}

/**
 * Gathers all values from the settings panel UI and returns a new settings object.
 * @returns {Object|null} The new settings object or null on error.
 */
/**
 * Gathers all values from the settings panel UI and returns a new settings object.
 * @returns {Object|null} The new settings object or null on error.
 */
export function updateSettingsFromUI() {
    let newSettings = {};
    try {
        newSettings.baseRate = parseFloat(document.getElementById('baseRate').value) || 0;
        
        // Weeks Out Policy
        const checkedWeeksOutMethod = document.querySelector('input[name="weeksOutMethod"]:checked');
        if (checkedWeeksOutMethod) {
            newSettings.weeksOutMethod = checkedWeeksOutMethod.value;
        }
        newSettings.weeksOutMileageThreshold = parseFloat(document.getElementById('weeksOutMileageThreshold').value) || 0;
        newSettings.weeksOutActiveDays = parseInt(document.getElementById('weeksOutActiveDays').value, 10) || 0;
        newSettings.weeksOutWeeklyMileage = parseFloat(document.getElementById('weeksOutWeeklyMileage').value) || 0;
        newSettings.weeksOutResetOnDaysOff = document.getElementById('weeksOutResetOnDaysOff').checked;

        newSettings.safetyScoreThreshold = parseFloat(document.getElementById('safetyScoreThreshold').value) || 0;
        newSettings.safetyScoreMileageThreshold = parseFloat(document.getElementById('safetyScoreMileageThreshold').value) || 0;
        newSettings.safetyScoreBonus = parseFloat(document.getElementById('safetyScoreBonus').value) || 0;
        newSettings.safetyBonusForfeitedOnSpeeding = document.getElementById('safetyBonusForfeitedOnSpeeding').checked;
        
        const checkedSpeedingMethod = document.querySelector('input[name="speedingPenaltyMethod"]:checked');
        if (checkedSpeedingMethod) {
            newSettings.speedingPenaltyMethod = checkedSpeedingMethod.value;
        }

        const includeZerosCheckbox = document.getElementById('include-speeding-zeros');
        newSettings.includeZerosInSpeedingCalc = includeZerosCheckbox ? includeZerosCheckbox.checked : false;

        // Time Off and Escrow policies.
        newSettings.timeOffBaseDays = parseInt(document.getElementById('timeOffBaseDays').value, 10) || 0;
        newSettings.timeOffStartAfterWeeks = parseInt(document.getElementById('timeOffStartAfterWeeks').value, 10) || 0;
        newSettings.timeOffWeeksPerDay = parseInt(document.getElementById('timeOffWeeksPerDay').value, 10) || 1;
        newSettings.escrowDeductionAmount = parseFloat(document.getElementById('escrowDeductionAmount').value) || 0;


        const standardTierKeys = ['weeksOutTiers', 'mpgPercentileTiers', 'tenureMilestones', 'speedingPercentileTiers'];
        standardTierKeys.forEach(key => {
            const section = document.querySelector(`[data-tier-key="${key}"]`);
            if (section) {
                const newTiers = [];
                section.querySelectorAll('.tier-row').forEach(row => {
                    const thresholdInput = row.querySelector('[data-type="threshold"]');
                    const bonusInput = row.querySelector('[data-type="bonus"]');
                    if (thresholdInput && bonusInput) {
                        const threshold = parseFloat(thresholdInput.value);
                        const bonus = parseFloat(bonusInput.value);
                        if (!isNaN(threshold) && !isNaN(bonus)) {
                            newTiers.push({ threshold, bonus });
                        }
                    }
                });
                newSettings[key] = newTiers;
            }
        });

        if (newSettings.speedingPenaltyMethod === 'perEvent') {
            newSettings.speedingPerEventMinimum = parseInt(document.getElementById('speedingPerEventMinimum').value, 10) || 0;
            newSettings.speedingPerEventPenalty = parseFloat(document.getElementById('speedingPerEventPenalty').value) || 0;
        } else if (newSettings.speedingPenaltyMethod === 'range') {
            const rangeTiers = [];
            const section = document.querySelector('[data-tier-key="speedingRangeTiers"]');
            if (section) {
                section.querySelectorAll('.tier-row').forEach(row => {
                    const from = parseInt(row.querySelector('[data-type="from"]').value, 10);
                    const toInput = row.querySelector('[data-type="to"]');
                    const to = toInput && toInput.value ? parseInt(toInput.value, 10) : Infinity;
                    const penalty = parseFloat(row.querySelector('[data-type="penalty"]').value);
                    if (!isNaN(from) && !isNaN(penalty)) {
                        rangeTiers.push({ from, to, penalty });
                    }
                });
            }
            newSettings.speedingRangeTiers = rangeTiers;
        }
        return newSettings;
    } catch (error) {
        console.error("CRITICAL ERROR while gathering settings:", error);
        alert("A critical error occurred while gathering the settings from the page. The save could not be completed.");
        return null;
    }
}

/**
 * Processes driver data for a specific date, calculating weeks out and percentiles.
 * @param {Array<Object>} driversForDate Array of drivers for the selected pay date.
 * @param {Array<Object>} mileageData All mileage records.
 * @param {Object} settings The application settings.
 * @returns {Array<Object>} The processed driver data with calculated fields.
 */
export function processDriverDataForDate(driversForDate, mileageData, settings, allSafetyData, overriddenDistances, daysTakenHistory, dispatcherOverrides) {
    if (driversForDate.length > 0) {
        const formatDate = (date) => date.toISOString().split('T')[0];
        const selectedDateStr = driversForDate[0].pay_date.split('T')[0];
        const selectedDate = new Date(selectedDateStr + 'T12:00:00Z');

        // New "Days Taken" Logic from Changelog
        driversForDate.forEach(driver => {
            // Define the current week's boundaries (Tuesday to Monday)
            const payDate = new Date(selectedDateStr + 'T12:00:00Z');
            const dayOfWeek = payDate.getUTCDay();
            const daysToSubtract = (dayOfWeek + 6) % 7;
            const monday = new Date(payDate);
            monday.setUTCDate(payDate.getUTCDate() - daysToSubtract);
            monday.setUTCHours(23, 59, 59, 999); // End of Monday

            const tuesday = new Date(monday);
            tuesday.setUTCDate(monday.getUTCDate() - 6);
            tuesday.setUTCHours(0, 0, 0, 0); // Start of Tuesday

            // Get all "DAY_OFF" records for the driver, considering overrides
            const driverDaysOffHistory = [];
            const allPossibleDates = [...new Set([
                ...daysTakenHistory.map(h => formatDate(new Date(h.date))),
                ...Object.keys(dispatcherOverrides).filter(k => k.startsWith(driver.name)).map(k => k.split('_')[1])
            ])];

            allPossibleDates.forEach(dateStr => {
                const overrideKey = `${driver.name}_${dateStr}`;
                const overrideStatus = dispatcherOverrides[overrideKey];

                if (overrideStatus === 'DAY_OFF') {
                    driverDaysOffHistory.push({ driver_name: driver.name, date: dateStr, activity_status: 'DAY_OFF' });
                } else if (!overrideStatus) {
                    // Only use system data if no override exists
                    const systemDayOff = daysTakenHistory.find(h => 
                        h.driver_name === driver.name &&
                        formatDate(new Date(h.date)) === dateStr &&
                        h.activity_status === 'DAY_OFF'
                    );
                    if (systemDayOff) {
                        driverDaysOffHistory.push(systemDayOff);
                    }
                }
            });

            // Count days taken THIS week and assign to driver.offDays
            const daysTakenThisWeek = driverDaysOffHistory.filter(h => {
                const recordDate = new Date(h.date);
                return recordDate >= tuesday && recordDate <= monday;
            }).length;
            driver.offDays = daysTakenThisWeek;

            // Count days taken PREVIOUSLY (before the start of the current week)
            const totalDaysTakenPreviously = driverDaysOffHistory.filter(h => {
                const recordDate = new Date(h.date);
                return recordDate < tuesday;
            }).length;
            driver.totalDaysTakenPreviously = totalDaysTakenPreviously;
        });
        
        // Weeks Out Calculation Logic
        if (mileageData.length > 0 || settings.weeksOutMethod === 'daysOff') {
            const formatDate = (date) => date.toISOString().split('T')[0];

            driversForDate.forEach(driver => {
                const driverMileageRecords = mileageData.filter(m => m.driver_name === driver.name);
                const driverDaysTakenRecords = daysTakenHistory.filter(h => h.driver_name === driver.name);

                // --- START: DYNAMIC LOOP LIMIT ---
                // Find the earliest date from both mileage and days taken history for this driver
                const firstMileageDate = driverMileageRecords.length > 0 
                    ? new Date(Math.min(...driverMileageRecords.map(r => new Date(r.date)))) 
                    : null;
                const firstDayTakenDate = driverDaysTakenRecords.length > 0 
                    ? new Date(Math.min(...driverDaysTakenRecords.map(r => new Date(r.date)))) 
                    : null;

                let earliestRecordDate = null;
                if (firstMileageDate && firstDayTakenDate) {
                    earliestRecordDate = new Date(Math.min(firstMileageDate, firstDayTakenDate));
                } else {
                    earliestRecordDate = firstMileageDate || firstDayTakenDate;
                }

                let maxWeeksToScan = 52; // Default to 52
                if (earliestRecordDate) {
                    const timeDiff = selectedDate.getTime() - earliestRecordDate.getTime();
                    // Calculate total weeks and add 1 to include the current week
                    maxWeeksToScan = Math.ceil(timeDiff / (1000 * 3600 * 24 * 7)) + 1;
                }
                // --- END: DYNAMIC LOOP LIMIT ---

                let consecutiveWeeks = 0;

                for (let i = 0; i < maxWeeksToScan; i++) {
                    const weekEndDate = new Date(selectedDate);
                    weekEndDate.setUTCDate(selectedDate.getUTCDate() - 3 - (i * 7));
                    const weekStartDate = new Date(weekEndDate);
                    weekStartDate.setUTCDate(weekEndDate.getUTCDate() - 6);

                    // Stop if we've gone past the earliest known data for the driver
                    if (earliestRecordDate && weekEndDate < earliestRecordDate) {
                        break;
                    }

                    // Check for the "reset on days off" rule first
                    if (settings.weeksOutResetOnDaysOff && (driver.offDays || 0) > 0) {
                        break; // Stop counting immediately if this rule is active and days were taken
                    }

                    let weekCountsAsOut = false;
                    switch (settings.weeksOutMethod) {
                        case 'weekly':
                            const weeklyTotalMiles = driverMileageRecords
                                .filter(m => m.date >= formatDate(weekStartDate) && m.date <= formatDate(weekEndDate))
                                .reduce((total, record) => total + (record.movement || 0), 0);
                            
                            if (weeklyTotalMiles >= settings.weeksOutWeeklyMileage) {
                                weekCountsAsOut = true;
                            }
                            break;
                        case 'daysOff':
                            const daysOffThisWeek = driverDaysTakenRecords.filter(h => {
                                const recordDate = new Date(h.date);
                                return h.activity_status === 'DAY_OFF' &&
                                       recordDate >= weekStartDate &&
                                       recordDate <= weekEndDate;
                            }).length;
                            
                            if (daysOffThisWeek === 0) {
                                weekCountsAsOut = true;
                            }
                            break;
                        case 'daily': // Default case
                        default:
                            const minDailyMiles = settings.weeksOutMileageThreshold || 0;
                            const minActiveDays = settings.weeksOutActiveDays || 0;
                            const activeDaysThisWeek = driverMileageRecords.filter(m => {
                                return m.date >= formatDate(weekStartDate) && m.date <= formatDate(weekEndDate) && m.movement >= minDailyMiles;
                            }).length;

                            if (activeDaysThisWeek >= minActiveDays) {
                                weekCountsAsOut = true;
                            }
                            break;
                    }

                    if (weekCountsAsOut) {
                        consecutiveWeeks++;
                    } else {
                        break; // Streak is broken
                    }
                }
                driver.weeksOut = consecutiveWeeks;

                const currentWeekEndDate = new Date(selectedDate);
                currentWeekEndDate.setUTCDate(selectedDate.getUTCDate() - 3);
                const currentWeekStartDate = new Date(currentWeekEndDate);
                currentWeekStartDate.setUTCDate(currentWeekEndDate.getUTCDate() - 6);
                const weeklyMiles = driverMileageRecords
                    .filter(m => m.date >= formatDate(currentWeekStartDate) && m.date <= formatDate(currentWeekEndDate))
                    .reduce((total, record) => total + (record.movement || 0), 0);
                driver.milesWeek = Math.round(weeklyMiles);

                if (allSafetyData && allSafetyData.length > 0) {
                    const safetyRecord = allSafetyData.find(record => record.name === driver.name && record.date.split('T')[0] === selectedDateStr);
                    if (safetyRecord && safetyRecord.totalDistance) {
                        driver.samsaraDistance = Math.round(parseFloat(safetyRecord.totalDistance));
                    }
                }
                
                // --- START: Weekly Activity Calculation ---
                const weeklyActivityData = [];
                const payDate = new Date(selectedDateStr + 'T12:00:00Z');

                const dayOfWeek = payDate.getUTCDay(); // Sunday = 0, Monday = 1, ...
                const daysToSubtract = (dayOfWeek + 6) % 7; // Calculate days to go back to get to Monday
                const monday = new Date(payDate);
                monday.setUTCDate(payDate.getUTCDate() - daysToSubtract);

                const tuesday = new Date(monday);
                tuesday.setUTCDate(monday.getUTCDate() - 6);

                const driverMileageMap = new Map(
                    driverMileageRecords.map(m => [m.date, m.movement || 0])
                );

                const driverChangelog = daysTakenHistory.filter(h => h.driver_name === driver.name);
                const dayLabels = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday'];
                const dayShortLabels = ['T', 'W', 'T', 'F', 'S', 'S', 'M'];

                for (let i = 0; i < 7; i++) {
                    const currentDay = new Date(tuesday);
                    currentDay.setUTCDate(tuesday.getUTCDate() + i);
                    const dayString = formatDate(currentDay);
                    const mileage = driverMileageMap.get(dayString) || 0;

                    const formattedDate = `${dayLabels[i]}, ${(currentDay.getUTCMonth() + 1).toString().padStart(2, '0')}.${currentDay.getUTCDate().toString().padStart(2, '0')}`;

                    const overrideKey = `${driver.name}_${dayString}`;
                    const overrideStatus = dispatcherOverrides[overrideKey];
                    const isOverridden = !!overrideStatus;

                    const statusesForDay = driverChangelog
                        .filter(log => new Date(log.date).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) === currentDay.toLocaleDateString('en-US', { timeZone: 'America/Chicago' }))
                        .map(log => log.activity_status);
                    const uniqueStatuses = [...new Set(statusesForDay)];
                    const systemStatusText = uniqueStatuses.length > 0 ? uniqueStatuses.join(', ') : 'No Status Change';

                    let finalStatus = systemStatusText;
                    let tooltipStatus = systemStatusText;
                    let isChanged = false;

                    if (isOverridden) {
                        // A dispatcher has reviewed this day.
                        if (overrideStatus !== 'CORRECT') {
                            // The status was explicitly changed to something other than 'CORRECT'.
                            // This is a true override.
                            finalStatus = overrideStatus;
                            tooltipStatus = `${overrideStatus} (Dispatch Override)`;
                            isChanged = true;
                        }
                        // If overrideStatus IS 'CORRECT', we do nothing.
                        // The tooltip will correctly show the original system status with no extra text.
                    }

                    weeklyActivityData.push({
                        day: dayShortLabels[i],
                        mileage: mileage,
                        fullDate: formattedDate,
                        statuses: finalStatus,
                        tooltipStatus: tooltipStatus,
                        isOverridden: isOverridden,
                        isChanged: isChanged
                    });
                }
                driver.weeklyActivity = weeklyActivityData;
                // --- END: Weekly Activity Calculation ---

// WITH THIS
// --- START: Dispatcher Confirmation Check ---
let isFullyConfirmed = true;
for (let i = 0; i < 7; i++) {
    const currentDay = new Date(tuesday);
    currentDay.setUTCDate(tuesday.getUTCDate() + i);
    const dayString = formatDate(currentDay);
    const overrideKey = `${driver.name}_${dayString}`;
    if (!dispatcherOverrides[overrideKey]) {
        isFullyConfirmed = false;
        break;
    }
}
driver.isDispatcherReviewed = isFullyConfirmed;
// --- END: Dispatcher Confirmation Check ---
            });
        }

        // Percentile Calculations
        driversForDate.forEach(driver => {
            const payDate = driver.pay_date.split('T')[0];
            const overrideKey = `${driver.id}_${payDate}`;
            const distanceSource = overriddenDistances[overrideKey] || 'milesWeek';
            const distance = distanceSource === 'samsaraDistance' ? driver.samsaraDistance : driver.milesWeek;
            const gallons = parseFloat(driver.gallons_fictive);
            driver.mpg = (gallons > 0 && distance > 0) ? (distance / gallons) : 0;
        });

        const driversWithMpg = driversForDate.filter(d => d.mpg > 0);
        const speedingPopulation = settings.includeZerosInSpeedingCalc ? [...driversForDate] : driversForDate.filter(d => d.speedingAlerts > 0);
        
        driversForDate.forEach(driver => {
            if (driver.mpg > 0 && driversWithMpg.length > 0) {
                const rank = driversWithMpg.filter(d => d.mpg < driver.mpg).length;
                driver.mpgPercentile = Math.round((rank / (driversWithMpg.length -1 || 1)) * 100);
            } else {
                driver.mpgPercentile = 0;
            }

            if (speedingPopulation.length > 0) {
                if (!settings.includeZerosInSpeedingCalc && driver.speedingAlerts === 0) {
                    driver.speedingPercentile = 0;
                } else {
                    const rank = speedingPopulation.filter(d => d.speedingAlerts < driver.speedingAlerts).length;
                    driver.speedingPercentile = Math.round((rank / (speedingPopulation.length - 1 || 1)) * 100);
                }
            } else {
                driver.speedingPercentile = 0;
            }
        });
    }
    return driversForDate;
}

/**
 * Calculates the percentile rank for a given MPG value against a set of drivers.
 * @param {number} mpgValue The MPG value to rank.
 * @param {Array<Object>} drivers The array of driver data to rank against.
 * @returns {number} The calculated percentile (0-100).
 */
export function calculateMpgPercentile(mpgValue, drivers) {
    if (isNaN(mpgValue) || mpgValue <= 0) return 0;
    const driversWithMpg = drivers.filter(d => parseFloat(d.mpg) > 0);
    if (driversWithMpg.length === 0) return 100; // If they are the only one with MPG, they are the best.

    const highestMpg = Math.max(...driversWithMpg.map(d => parseFloat(d.mpg)));
    if (mpgValue >= highestMpg) {
        return 100;
    }

    const populationCount = driversWithMpg.length;
    const rank = driversWithMpg.filter(d => parseFloat(d.mpg) < mpgValue).length;
    const denominator = populationCount > 1 ? populationCount - 1 : 1;
    return Math.round((rank / denominator) * 100);
}

/**
 * Calculates the percentile rank for a given number of speeding alerts.
 * @param {number} speedingValue The number of alerts to rank.
 * @param {Array<Object>} drivers The array of driver data to rank against.
 * @param {Object} settings The application settings to check for zero-inclusion rule.
 * @returns {number} The calculated percentile (0-100).
 */
export function calculateSpeedingPercentile(speedingValue, drivers, settings) {
    if (isNaN(speedingValue)) return 0;
    const speedingPopulation = settings.includeZerosInSpeedingCalc ? [...drivers] : drivers.filter(d => d.speedingAlerts > 0);
    if (speedingPopulation.length === 0) return 0;
    
    if (!settings.includeZerosInSpeedingCalc && speedingValue === 0) {
        return 0;
    }

    const highestAlerts = Math.max(...speedingPopulation.map(d => d.speedingAlerts));
    if (speedingValue >= highestAlerts) {
        return 100;
    }

    const populationCount = speedingPopulation.length;
    const rank = speedingPopulation.filter(d => d.speedingAlerts < speedingValue).length;
    const denominator = populationCount > 1 ? populationCount - 1 : 1;
    return Math.round((rank / denominator) * 100);
}