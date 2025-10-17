// TPOG/js/calculations.js

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

    // Check if an override for escrowDeduct exists on the driver object. If so, use it and stop further calculation for it.
    if (driver.hasOwnProperty('escrowDeduct')) {
        report.escrowDeduct = parseFloat(driver.escrowDeduct) || 0;
    }

    // Weeks Out Bonus
    const weeksOutDetails = getTieredBonusDetails(driver.weeksOut, settings.weeksOutTiers);
    report.bonuses['Weeks Out'] = { bonus: weeksOutDetails.bonus };
    report.totalBonus += weeksOutDetails.bonus;

    // Safety Score Bonus
    let safetyBonus = 0;
    const scoreMet = driver.safetyScore >= settings.safetyScoreThreshold;
    const milesMet = driver.stubMiles >= settings.safetyScoreMileageThreshold;
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
    let fuelBonus = 0;
    // Only apply a fuel bonus or penalty if the driver has a calculated MPG greater than zero.
    if (driver.mpg > 0) {
        const percentileDetails = getTieredBonusDetails(driver.mpgPercentile, settings.mpgPercentileTiers);
        fuelBonus = percentileDetails.bonus;
    }
    report.bonuses['Fuel Efficiency'] = { bonus: fuelBonus };
    report.totalBonus += fuelBonus;

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
    
    const grossPay = driver.gross || 0;
    report.bonusesInDollars = (report.totalPositiveBonuses / 100) * grossPay;
    report.penaltiesInDollars = (report.totalPenalties / 100) * grossPay;



 const daysTakenThisWeek = driver.offDays || 0;
    const balanceAtStartOfWeek = driver.balanceAtStartOfWeek || 0;
    const streakAtStartOfWeek = driver.streakAtStartOfWeek || 0;
    const currentStreak = driver.weeksOut || 0;

    let newlyEarnedThisWeek = 0;
    const startThreshold = settings.timeOffStartAfterWeeks || 3;
    const weeksPerDay = settings.timeOffWeeksPerDay || 1;

    // Check if the threshold was crossed during this week
    if (currentStreak >= startThreshold && streakAtStartOfWeek < startThreshold) {
        newlyEarnedThisWeek += settings.timeOffBaseDays;
        // Also add any additional full weeks earned in the same period
        const additionalFullWeeks = Math.floor(currentStreak) - startThreshold;
        if (additionalFullWeeks > 0) {
            newlyEarnedThisWeek += additionalFullWeeks / weeksPerDay;
        }
    } else if (currentStreak > streakAtStartOfWeek && currentStreak > startThreshold) {
        // If we are already past the threshold, calculate earnings based on the increase in full weeks
        const newFullWeeksEarned = Math.floor(currentStreak) - Math.floor(streakAtStartOfWeek);
        if (newFullWeeksEarned > 0) {
            newlyEarnedThisWeek = newFullWeeksEarned / weeksPerDay;
        }
    }

    const currentAvailable = balanceAtStartOfWeek + newlyEarnedThisWeek;
    report.availableOffDays = Math.max(0, currentAvailable);

// Only calculate escrow if an override hasn't already set the value.
if (!driver.hasOwnProperty('escrowDeduct')) {
    const excessDays = Math.max(0, daysTakenThisWeek - Math.max(0, balanceAtStartOfWeek));
    report.escrowDeduct = excessDays * (settings.escrowDeductionAmount || 0);
}

    const excessDays = Math.max(0, daysTakenThisWeek - Math.max(0, balanceAtStartOfWeek));
    report.escrowDeduct = excessDays * (settings.escrowDeductionAmount || 0);
    
    // Final TPOG
    report.totalTpog = settings.baseRate + report.totalBonus;
    report.estimatedNet = (report.totalTpog / 100) * (driver.gross || 0);
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
        const weeksOutMethodChecked = document.querySelector('input[name="weeksOutMethod"]:checked');
        newSettings.weeksOutMethod = weeksOutMethodChecked ? weeksOutMethodChecked.value : 'fullWeeksOnly';
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
export function processDriverDataForDate(driversForDate, mileageData, settings, allSafetyData, overriddenDistances, daysTakenHistory, dispatcherOverrides, allDrivers) {
    if (driversForDate.length > 0) {
        const formatDate = (date) => date.toISOString().split('T')[0];
        const selectedDateStr = driversForDate[0].pay_date.split('T')[0];
        const selectedDate = new Date(selectedDateStr + 'T12:00:00Z');

        // TPOG/js/calculations.js

       driversForDate.forEach(driver => {
        const performanceDate = new Date(selectedDateStr + 'T12:00:00Z');
        if (driver.pay_delayWks === 2) {
            performanceDate.setUTCDate(performanceDate.getUTCDate() - 7);
        }

        const dayOfWeek = performanceDate.getUTCDay();
        const daysToSubtract = (dayOfWeek + 6) % 7;
        const monday = new Date(performanceDate);
        monday.setUTCDate(performanceDate.getUTCDate() - daysToSubtract);
        monday.setUTCHours(23, 59, 59, 999);

        const tuesday = new Date(monday);
        tuesday.setUTCDate(monday.getUTCDate() - 6);
        tuesday.setUTCHours(0, 0, 0, 0);

        const driverMileageRecords = mileageData.filter(m => m.driver_name === driver.name);
        const allDaysOffHistory = [];

        const allPossibleDates = [...new Set([
            ...daysTakenHistory.map(h => formatDate(new Date(h.date))),
            ...Object.keys(dispatcherOverrides).filter(k => k.startsWith(driver.name)).map(k => k.split('_')[1])
        ])];

        allPossibleDates.forEach(dateStr => {
            const overrideKey = `${driver.name}_${dateStr}`;
            const overrideStatus = dispatcherOverrides[overrideKey];
            let isDayOff = false;

            if (overrideStatus === 'DAY_OFF') {
                isDayOff = true;
            } else if (overrideStatus === 'NOT_STARTED') {
                isDayOff = false; // Explicitly not a day off
            } else if (overrideStatus !== 'CORRECT' && overrideStatus !== undefined) {
                isDayOff = false;
            } else {
                const systemDayOff = daysTakenHistory.some(h =>
                    h.driver_name === driver.name &&
                    formatDate(new Date(h.date)) === dateStr &&
                    h.activity_status === 'DAY_OFF'
                );
                if (systemDayOff) {
                    isDayOff = true;
                }
            }

            if (isDayOff) {
                allDaysOffHistory.push({ driver_name: driver.name, date: dateStr, activity_status: 'DAY_OFF' });
            }
        });
        
        const uniqueDaysOff = [...new Map(allDaysOffHistory.map(item => [item['date'], item])).values()];

        let daysTakenThisWeek = 0;
        let daysTakenPreviously = 0;

        daysTakenThisWeek = uniqueDaysOff.filter(h => {
            const recordDate = new Date(h.date + 'T12:00:00Z');
            return recordDate >= tuesday && recordDate <= monday;
        }).length;
        daysTakenPreviously = uniqueDaysOff.filter(h => {
            const recordDate = new Date(h.date + 'T12:00:00Z');
            return recordDate < tuesday;
        }).length;
        
        driver.offDays = daysTakenThisWeek;
        driver.totalDaysTakenPreviously = daysTakenPreviously;
        driver.fullDaysOffHistory = uniqueDaysOff;
    });
        
    if (mileageData.length > 0 || settings.weeksOutMethod === 'daysOff' || settings.weeksOutMethod === 'dailyAccrual' || settings.weeksOutMethod === 'fullWeeksOnly') {
        const formatDate = (date) => date.toISOString().split('T')[0];
        const selectedDateStr = driversForDate[0].pay_date.split('T')[0];

        driversForDate.forEach(driver => {
            const driverMileageRecords = mileageData.filter(m => m.driver_name === driver.name);
            const allRecordsForDriver = allDrivers
                .filter(d => d.name === driver.name && d.pay_date)
                .sort((a, b) => new Date(a.pay_date) - new Date(b.pay_date));

                let streak = 0;
                let earnedDays = 0;
                let takenDays = 0;
                const payDatesProcessed = new Set();
                const dailyContribution = 0.1429;
    
                if (settings.weeksOutMethod === 'dailyAccrual') {
                    let continuousDayStreak = 0;
    
                    for (const record of allRecordsForDriver) {
                        const recordPayDateStr = record.pay_date.split('T')[0];
                        if (payDatesProcessed.has(recordPayDateStr)) continue;
                        payDatesProcessed.add(recordPayDateStr);
    
                        const performanceDate = new Date(recordPayDateStr + 'T12:00:00Z');
                        if (record.pay_delayWks === 2) performanceDate.setUTCDate(performanceDate.getUTCDate() - 7);
                        
                        const monday = new Date(performanceDate);
                        monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
                        const tuesday = new Date(monday);
                        tuesday.setUTCDate(monday.getUTCDate() - 6);
    
                        const daysOffInWeek = driver.fullDaysOffHistory.filter(h => {
                            const recordDate = new Date(h.date + 'T12:00:00Z');
                            return recordDate >= tuesday && recordDate <= monday;
                        }).length;
    
                        const oldStreakInWeeks = Math.floor(continuousDayStreak * dailyContribution);
    
                        for (let i = 0; i < 7; i++) {
                            const currentDay = new Date(tuesday);
                            currentDay.setUTCDate(tuesday.getUTCDate() + i);
                            const isDayOff = driver.fullDaysOffHistory.some(h => new Date(h.date + 'T12:00:00Z').getTime() === currentDay.getTime());
                            
                            const dayString = formatDate(currentDay);
                            const overrideKey = `${driver.name}_${dayString}`;
                            const overrideStatus = dispatcherOverrides[overrideKey];
                            const isNotStarted = overrideStatus === 'NOT_STARTED';
                            const isContractEnded = overrideStatus === 'CONTRACT_ENDED';
    
                            if ((settings.weeksOutResetOnDaysOff && isDayOff) || isNotStarted || isContractEnded) {
                                continuousDayStreak = 0;
                            } else if (!isDayOff) {
                                continuousDayStreak++;
                            }
                        }
                        
                        const newStreakInWeeks = Math.floor(continuousDayStreak * dailyContribution);
    
                        if (recordPayDateStr === selectedDateStr) {
                            driver.weeksOut = continuousDayStreak * dailyContribution;
                            driver.offDays = daysOffInWeek;
                            driver.balanceAtStartOfWeek = earnedDays - takenDays;
                            driver.streakAtStartOfWeek = oldStreakInWeeks;
                            break;
                        }
    
                        takenDays += daysOffInWeek;
    
                        if (newStreakInWeeks > oldStreakInWeeks) {
                            for (let i = oldStreakInWeeks + 1; i <= newStreakInWeeks; i++) {
                                if (i === settings.timeOffStartAfterWeeks) {
                                    earnedDays += settings.timeOffBaseDays;
                                } else if (i > settings.timeOffStartAfterWeeks) {
                                    earnedDays += (1 / (settings.timeOffWeeksPerDay || 1));
                                }
                            }
                        }
                    }
    
                } else { // Handles 'fullWeeksOnly'
                    for (const record of allRecordsForDriver) {
                        const recordPayDateStr = record.pay_date.split('T')[0];
                        if (payDatesProcessed.has(recordPayDateStr)) continue;
                        payDatesProcessed.add(recordPayDateStr);
                        
                        const performanceDate = new Date(recordPayDateStr + 'T12:00:00Z');
                        if (record.pay_delayWks === 2) performanceDate.setUTCDate(performanceDate.getUTCDate() - 7);
                        
                        const monday = new Date(performanceDate);
                        monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
                        const tuesday = new Date(monday);
                        tuesday.setUTCDate(monday.getUTCDate() - 6);
    
                        const daysOffInWeek = driver.fullDaysOffHistory.filter(h => {
                            const recordDate = new Date(h.date + 'T12:00:00Z');
                            return recordDate >= tuesday && recordDate <= monday;
                        }).length;
                        
                        let hasNotStartedInWeek = false;
                        for (let i = 0; i < 7; i++) {
                            const currentDay = new Date(tuesday);
                            currentDay.setUTCDate(tuesday.getUTCDate() + i);
                            const dayString = formatDate(currentDay);
                            const overrideKey = `${driver.name}_${dayString}`;
                            const overrideStatus = dispatcherOverrides[overrideKey];
                            if (overrideStatus === 'NOT_STARTED' || overrideStatus === 'CONTRACT_ENDED') {
                                hasNotStartedInWeek = true;
                                break;
                            }
                        }

                        let weekMetCriteria = daysOffInWeek === 0 && !hasNotStartedInWeek;
                        if (settings.weeksOutResetOnDaysOff && !weekMetCriteria) {
                            streak = 0;
                        }
    
                        if (recordPayDateStr === selectedDateStr) {
                            driver.weeksOut = weekMetCriteria ? streak + 1 : streak;
                            driver.offDays = daysOffInWeek;
                            driver.balanceAtStartOfWeek = earnedDays - takenDays;
                            driver.streakAtStartOfWeek = streak;
                            break;
                        }
    
                        takenDays += daysOffInWeek;
                        const oldStreak = streak;
                        if (weekMetCriteria) {
                            streak++;
                        }
                        
                        if (streak > oldStreak) {
                            if (streak === settings.timeOffStartAfterWeeks) {
                                earnedDays += settings.timeOffBaseDays;
                            } else if (streak > settings.timeOffStartAfterWeeks) {
                                earnedDays += (1 / (settings.timeOffWeeksPerDay || 1));
                            }
                        }
                    }
                }
            
            const performanceDateForLimit = new Date(selectedDateStr + 'T12:00:00Z');
            if (driver.pay_delayWks === 2) {
               performanceDateForLimit.setUTCDate(performanceDateForLimit.getUTCDate() - 7);
            }
            const mondayOfCurrentWeek = new Date(performanceDateForLimit);
            const dayOfWeek_current = mondayOfCurrentWeek.getUTCDay();
            const daysToSubtract_current = (dayOfWeek_current + 6) % 7;
            mondayOfCurrentWeek.setUTCDate(mondayOfCurrentWeek.getUTCDate() - daysToSubtract_current);
            const tuesdayOfCurrentWeek = new Date(mondayOfCurrentWeek);
            tuesdayOfCurrentWeek.setUTCDate(mondayOfCurrentWeek.getUTCDate() - 6);

            driver.milesWeek = Math.round(driverMileageRecords
                .filter(m => m.date >= formatDate(tuesdayOfCurrentWeek) && m.date <= formatDate(mondayOfCurrentWeek))
                .reduce((total, record) => total + (record.movement || 0), 0));

            if (allSafetyData && allSafetyData.length > 0) {
                 const performanceDateStr = formatDate(performanceDateForLimit);
                const safetyRecord = allSafetyData.find(record => record.name === driver.name && record.date.split('T')[0] === performanceDateStr);
                if (safetyRecord && safetyRecord.totalDistance) {
                    driver.samsaraDistance = Math.round(parseFloat(safetyRecord.totalDistance));
                }
            }

            const weeklyActivityData = [];
            const driverChangelog = daysTakenHistory.filter(h => h.driver_name === driver.name);
            const dayLabels = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday'];
            const dayShortLabels = ['T', 'W', 'T', 'F', 'S', 'S', 'M'];

            for (let i = 0; i < 7; i++) {
                const currentDay = new Date(tuesdayOfCurrentWeek);
                currentDay.setUTCDate(tuesdayOfCurrentWeek.getUTCDate() + i);
                const dayString = formatDate(currentDay);
                const mileage = new Map(driverMileageRecords.map(m => [m.date, m.movement || 0])).get(dayString) || 0;
                const formattedDate = `${dayLabels[i]}, ${(currentDay.getUTCMonth() + 1).toString().padStart(2, '0')}.${currentDay.getUTCDate().toString().padStart(2, '0')}`;
                const overrideKey = `${driver.name}_${dayString}`;
                const overrideStatus = dispatcherOverrides[overrideKey];
                const isOverridden = !!overrideStatus;
                const statusesForDay = driverChangelog.filter(log => new Date(log.date).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) === currentDay.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })).map(log => log.activity_status);
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
                weeklyActivityData.push({ day: dayShortLabels[i], mileage: mileage, fullDate: formattedDate, statuses: finalStatus, tooltipStatus: tooltipStatus, isOverridden: isOverridden, isChanged: isChanged });
            }
            driver.weeklyActivity = weeklyActivityData;
            let isFullyConfirmed = true;
            for (let i = 0; i < 7; i++) {
                const currentDay = new Date(tuesdayOfCurrentWeek);
                currentDay.setUTCDate(tuesdayOfCurrentWeek.getUTCDate() + i);
                const dayString = formatDate(currentDay);
                const overrideKey = `${driver.name}_${dayString}`;
                if (!dispatcherOverrides[overrideKey]) {
                    isFullyConfirmed = false;
                    break;
                }
            }
            driver.isDispatcherReviewed = isFullyConfirmed;
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