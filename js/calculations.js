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
export function getDriverReportData(driver, settings, driversForDate = []) {
    const report = { totalBonus: 0, totalPenalties: 0, bonuses: {}, totalTpog: 0, availableOffDays: 0, escrowDeduct: 0 };
    const grossPay = driver.gross || 0;

    // --- NEW CHECK ADDED ---
    // If gross is zero or non-existent, ignore all bonus/penalty metrics.
    if (grossPay <= 0) {
        report.totalTpog = settings.baseRate; // Set TPOG to base rate
        report.estimatedNet = 0;              // Net pay is 0

        // Check for escrow override (must still run)
        if (driver.hasOwnProperty('escrowDeduct')) {
            report.escrowDeduct = parseFloat(driver.escrowDeduct) || 0;
        }

        // --- Run Time Off & Escrow calculation (it's independent of gross) ---
        const daysTakenThisWeek = driver.offDays || 0;
        const balanceAtStartOfWeek = driver.balanceAtStartOfWeek || 0;
        const streakAtStartOfWeek = driver.streakAtStartOfWeek || 0;
        const currentStreak = driver.weeksOut || 0;

        let newlyEarnedThisWeek = 0;
        const startThreshold = settings.timeOffStartAfterWeeks || 3;
        const weeksPerDay = settings.timeOffWeeksPerDay || 1;

        if (currentStreak >= startThreshold && streakAtStartOfWeek < startThreshold) {
            newlyEarnedThisWeek += settings.timeOffBaseDays;
            const additionalFullWeeks = Math.floor(currentStreak) - startThreshold;
            if (additionalFullWeeks > 0) {
                newlyEarnedThisWeek += additionalFullWeeks / weeksPerDay;
            }
        } else if (currentStreak > streakAtStartOfWeek && currentStreak > startThreshold) {
            const newFullWeeksEarned = Math.floor(currentStreak) - Math.floor(streakAtStartOfWeek);
            if (newFullWeeksEarned > 0) {
                newlyEarnedThisWeek = newFullWeeksEarned / weeksPerDay;
            }
        }

        const currentAvailable = balanceAtStartOfWeek + newlyEarnedThisWeek;
        report.availableOffDays = Math.max(0, currentAvailable);

        if (!driver.hasOwnProperty('escrowDeduct')) {
            const excessDays = Math.max(0, daysTakenThisWeek - Math.max(0, balanceAtStartOfWeek));
            report.escrowDeduct = excessDays * (settings.escrowDeductionAmount || 0);
        }
        


        // --- FIX IS HERE ---
        // Add these lines to prevent the UI from crashing
        report.totalPositiveBonuses = 0;
        report.totalPenalties = 0;
        // ALSO add default bonus objects to prevent download crash
        report.bonuses['Weeks Out'] = { bonus: 0 };
        report.bonuses['Safety Score'] = { bonus: 0 };
        report.bonuses['Speeding Penalty'] = { bonus: 0 };
        report.bonuses['Fuel Efficiency'] = { bonus: 0 };
        report.bonuses['Tenure'] = { bonus: 0 };
        report.bonuses['Gross Target'] = { bonus: 0 };
        // --- END OF FIX ---

        // Return the report early, skipping all bonus/penalty logic
        return report;
    }
    // --- END OF NEW CHECK ---


    // Check if an override for escrowDeduct exists on the driver object. If so, use it and stop further calculation for it.
    if (driver.hasOwnProperty('escrowDeduct')) {
        report.escrowDeduct = parseFloat(driver.escrowDeduct) || 0;
    }

    // Weeks Out Bonus
    if (settings.enabledMetrics?.weeksOut ?? true) {
        const weeksOutDetails = getTieredBonusDetails(driver.weeksOut, settings.weeksOutTiers);
        report.bonuses['Weeks Out'] = { bonus: weeksOutDetails.bonus };
        report.totalBonus += weeksOutDetails.bonus;
    } else {
        report.bonuses['Weeks Out'] = { bonus: 0 };
    }

    // Safety Score Bonus & Speeding Penalty
    if (settings.enabledMetrics?.safety ?? true) {
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
    } else {
        report.bonuses['Safety Score'] = { bonus: 0 };
        report.bonuses['Speeding Penalty'] = { bonus: 0 };
    }

    // Fuel Efficiency Bonus
    if (settings.enabledMetrics?.fuel ?? true) {
        let fuelBonus = 0;
        let infoText = 'Fuel bonus not applicable.'; // Default text
        const fuelMileageThreshold = settings.fuelMileageThreshold || 0;
        const driverMiles = driver.stubMiles || 0;

        if (driverMiles >= fuelMileageThreshold && driver.mpg > 0) {
            const percentileDetails = getTieredBonusDetails(driver.mpgPercentile, settings.mpgPercentileTiers);
            fuelBonus = percentileDetails.bonus;

            // --- START: Pre-calculate infoText ---
            const currentMpg = parseFloat(driver.mpg);
            const currentPercentile = driver.mpgPercentile;
            const sortedTiers = [...settings.mpgPercentileTiers].sort((a, b) => a.threshold - b.threshold);
            let targetTier = null;
            
            if (fuelBonus < 0) {
                targetTier = sortedTiers.find(t => t.bonus >= 0); // Find first non-negative tier
            } else {
                targetTier = sortedTiers.find(t => t.bonus > fuelBonus); // Find next highest tier
            }

            if (targetTier && driversForDate && driversForDate.length > 0) {
                const targetPercentile = targetTier.threshold;
                // Use the full driver list passed into the function
                const allMpgValues = driversForDate.map(d => parseFloat(d.mpg)).filter(mpg => mpg > 0).sort((a, b) => a - b);
                let targetMpg = 0;

                if (allMpgValues.length > 1) {
                    const targetIndex = Math.ceil((targetPercentile / 100) * (allMpgValues.length - 1));
                    targetMpg = allMpgValues[targetIndex];
                } else if (allMpgValues.length === 1) {
                    targetMpg = allMpgValues[0];
                }

                if (targetMpg > 0 && targetMpg > currentMpg) {
                    if (fuelBonus < 0) {
                        infoText = `Reach ${targetMpg.toFixed(1)} MPG to remove the penalty.`;
                    } else {
                        infoText = `Reach ${targetMpg.toFixed(1)} MPG for a +${targetTier.bonus.toFixed(1)}% bonus.`;
                    }
                } else {
                    infoText = 'Keep up the great work!';
                }
            } else if (targetTier) {
                // Fallback if full driver data isn't available (should not happen for lock)
                infoText = fuelBonus < 0 ? 'Improve MPG to remove penalty.' : `Reach ${targetTier.threshold} percentile for next bonus.`;
            } else {
                infoText = 'Maximum fuel bonus reached.';
            }
            // --- END: Pre-calculate infoText ---

        } else if (driverMiles < fuelMileageThreshold) {
            infoText = `Drive ${fuelMileageThreshold} miles to qualify for fuel bonus.`;
        } else if (driver.mpg <= 0) {
            infoText = 'No MPG data available to calculate bonus.';
        }
        
        report.bonuses['Fuel Efficiency'] = { bonus: fuelBonus, infoText: infoText }; // Save infoText
        report.totalBonus += fuelBonus;
    } else {
        report.bonuses['Fuel Efficiency'] = { bonus: 0, infoText: 'Fuel metric disabled.' };
    }

    // Tenure Bonus
    if (settings.enabledMetrics?.tenure ?? true) {
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
    } else {
        report.bonuses['Tenure'] = { bonus: 0 };
    }

    // --- MODIFIED: Gross Target Bonus ---
    if (settings.enabledMetrics?.grossTarget ?? true) {
        if (driver.ignoreGrossBonus === true || driver.ignoreGrossBonus === 'true') {
            report.bonuses['Gross Target'] = { bonus: 0 };
            // We consciously do NOT add to totalBonus here
        } else {
            let grossBonus = 0;
            // Use the same range logic as speeding, but with 'bonus'
            const sortedTiers = (settings.grossTargetTiers || []).sort((a, b) => a.from - b.from);
            for (const tier of sortedTiers) {
                const from = tier.from;
                const to = tier.to || Infinity;
                // Use driver.gross here
                if (driver.gross >= from && driver.gross <= to) {
                    grossBonus = tier.bonus;
                    break; // Found the matching tier
                }
            }
            report.bonuses['Gross Target'] = { bonus: grossBonus };
            report.totalBonus += grossBonus;
        }
    } else {
        report.bonuses['Gross Target'] = { bonus: 0 };
    }
    // --- END MODIFICATION ---

    // Separate Bonuses and Penalties
    report.totalPositiveBonuses = Object.values(report.bonuses).reduce((sum, { bonus }) => sum + Math.max(0, bonus), 0);
    report.totalPenalties = Object.values(report.bonuses).reduce((sum, { bonus }) => sum + Math.min(0, bonus), 0);
    
    // const grossPay = driver.gross || 0; // This was moved to the top
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
        
        newSettings.enabledMetrics = {
            weeksOut: document.getElementById('metric-toggle-weeksOut').checked,
            safety: document.getElementById('metric-toggle-safety').checked,
            fuel: document.getElementById('metric-toggle-fuel').checked,
            tenure: document.getElementById('metric-toggle-tenure').checked,
            grossTarget: document.getElementById('metric-toggle-grossTarget').checked,
        };

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

        newSettings.fuelMileageThreshold = parseFloat(document.getElementById('fuelMileageThreshold').value) || 0;

        // --- MODIFIED: Split standard (threshold) tiers and range tiers ---
        
        // 1. Read THRESHOLD tiers
        const standardTierKeys = ['weeksOutTiers', 'mpgPercentileTiers', 'tenureMilestones', 'speedingPercentileTiers'];
        standardTierKeys.forEach(key => {
            // Skip speedingPercentileTiers if method is not 'percentile'
            if (key === 'speedingPercentileTiers' && newSettings.speedingPenaltyMethod !== 'percentile') return;
            
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

        // 2. Read GROSS TARGET tiers (Range)
        const grossSection = document.querySelector('[data-tier-key="grossTargetTiers"]');
        if (grossSection) {
            const grossTiers = [];
            grossSection.querySelectorAll('.tier-row').forEach(row => {
                const from = parseFloat(row.querySelector('[data-type="from"]').value);
                const toInput = row.querySelector('[data-type="to"]');
                const to = toInput && toInput.value ? parseFloat(toInput.value) : Infinity;
                const bonus = parseFloat(row.querySelector('[data-type="bonus"]').value);
                if (!isNaN(from) && !isNaN(bonus)) {
                    grossTiers.push({ from, to, bonus });
                }
            });
            newSettings.grossTargetTiers = grossTiers;
        }

        // 3. Read SPEEDING tiers (Range or Per-Event)
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
 * @param {Object} mileageIndex Indexed mileage data by driver name.
 * @param {Object} settings The application settings.
 * @param {Object} safetyIndex Indexed safety data by driver name.
 * @param {Object} overriddenDistances Map of distance overrides.
 * @param {Object} daysTakenIndex Indexed days off history by driver name.
 * @param {Object} dispatcherOverrides Map of dispatcher overrides.
 * @param {Array<Object>} allDrivers List of all drivers (for Weeks Out calc).
 * @returns {Array<Object>} The processed driver data with calculated fields.
 */
export function processDriverDataForDate(driversForDate, mileageIndex, settings, safetyIndex, overriddenDistances, daysTakenIndex, dispatcherOverrides, allDrivers) {
    if (driversForDate.length > 0) {
        const formatDate = (date) => date.toISOString().split('T')[0];
        const selectedDateStr = driversForDate[0].pay_date.split('T')[0];

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

        const tuesdayStr = formatDate(tuesday);
        const mondayStr = formatDate(monday);

        // --- OPTIMIZATION: Use Index ---
        const driverMileageRecords = mileageIndex[driver.name] || [];
        const driverDaysOffHistory = daysTakenIndex[driver.name] || [];
        // -------------------------------

        const allDaysOffHistory = [];
        const allPossibleDates = [...new Set([
            ...driverDaysOffHistory.map(h => formatDate(new Date(h.date))),
            ...Object.keys(dispatcherOverrides).filter(k => k.startsWith(driver.name)).map(k => k.split('_')[1])
        ])];

        allPossibleDates.forEach(dateStr => {
            const overrideKey = `${driver.name}_${dateStr}`;
            const overrideStatus = dispatcherOverrides[overrideKey];
            let isDayOff = false;

            if (overrideStatus === 'DAY_OFF') {
                isDayOff = true;
            } else if (overrideStatus === 'NOT_STARTED') {
                isDayOff = false; 
            } else if (overrideStatus !== 'CORRECT' && overrideStatus !== undefined) {
                isDayOff = false;
            } else {
                const systemDayOff = driverDaysOffHistory.some(h =>
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

        // Filter using strict string comparison for YYYY-MM-DD
        const daysTakenThisWeek = uniqueDaysOff.filter(h => {
            const dateStr = formatDate(new Date(h.date));
            return dateStr >= tuesdayStr && dateStr <= mondayStr;
        }).length;
        
        const daysTakenPreviously = uniqueDaysOff.filter(h => {
            const dateStr = formatDate(new Date(h.date));
            return dateStr < tuesdayStr;
        }).length;
        
        driver.offDays = daysTakenThisWeek;
        driver.totalDaysTakenPreviously = daysTakenPreviously;
        driver.fullDaysOffHistory = uniqueDaysOff;
        
        // --- FIX 1: Normalize dates for milesWeek calculation ---
        // Ensure m.date is treated as YYYY-MM-DD for comparison
        driver.milesWeek = Math.round(driverMileageRecords
            .filter(m => {
                const mDateStr = m.date.split('T')[0]; 
                return mDateStr >= tuesdayStr && mDateStr <= mondayStr;
            })
            .reduce((total, record) => total + (record.movement || 0), 0));

        if (safetyIndex) {
            const driverSafetyRecords = safetyIndex[driver.name] || [];
            const performanceDateStr = formatDate(performanceDate);
            const safetyRecord = driverSafetyRecords.find(record => record.date.split('T')[0] === performanceDateStr);
            if (safetyRecord && safetyRecord.totalDistance) {
                driver.samsaraDistance = Math.round(parseFloat(safetyRecord.totalDistance));
            }
        }

        const weeklyActivityData = [];
        const dayLabels = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday'];
        const dayShortLabels = ['T', 'W', 'T', 'F', 'S', 'S', 'M'];
        
        // --- FIX 2: Normalize keys for mileage map ---
        const mileageMap = new Map();
        driverMileageRecords.forEach(m => {
            const mDateStr = m.date.split('T')[0];
            if (mDateStr >= tuesdayStr && mDateStr <= mondayStr) {
                mileageMap.set(mDateStr, (mileageMap.get(mDateStr) || 0) + (m.movement || 0));
            }
        });

        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(tuesday);
            currentDay.setUTCDate(tuesday.getUTCDate() + i);
            const dayString = formatDate(currentDay);
            
            // Now map lookup works because keys match
            const mileage = mileageMap.get(dayString) || 0;
            
            const formattedDate = `${dayLabels[i]}, ${(currentDay.getUTCMonth() + 1).toString().padStart(2, '0')}.${currentDay.getUTCDate().toString().padStart(2, '0')}`;
            const overrideKey = `${driver.name}_${dayString}`;
            const overrideStatus = dispatcherOverrides[overrideKey];
            const isOverridden = !!overrideStatus;
            
            // --- FIX: Use strict string comparison (YYYY-MM-DD) for status lookup ---
            const statusesForDay = driverDaysOffHistory
                .filter(log => formatDate(new Date(log.date)) === dayString)
                .map(log => log.activity_status);
            // -----------------------------------------------------------------------

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
    });
        
    // Weeks Out Calculation
    if (settings.weeksOutMethod === 'daysOff' || settings.weeksOutMethod === 'dailyAccrual' || settings.weeksOutMethod === 'fullWeeksOnly') {
        const formatDate = (date) => date.toISOString().split('T')[0];
        const selectedDateStr = driversForDate[0].pay_date.split('T')[0];

        driversForDate.forEach(driver => {
            const allRecordsForDriver = allDrivers
                .filter(d => d.name === driver.name && d.pay_date)
                .sort((a, b) => new Date(a.pay_date) - new Date(b.pay_date));

            let runningBalance = 0; 
            let streak = 0;
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
    
                        let resetTriggeredThisWeek = false;
                        for (let i = 0; i < 7; i++) {
                            const currentDay = new Date(tuesday);
                            currentDay.setUTCDate(tuesday.getUTCDate() + i);
                            const dayString = formatDate(currentDay);
                            const overrideKey = `${driver.name}_${dayString}`;
                            const overrideStatus = dispatcherOverrides[overrideKey];
                            if (overrideStatus === 'NOT_STARTED' || overrideStatus === 'CONTRACT_ENDED') {
                                resetTriggeredThisWeek = true;
                                break;
                            }
                        }
    
                        if (recordPayDateStr === selectedDateStr) {
                            driver.weeksOut = continuousDayStreak * dailyContribution;
                            if (resetTriggeredThisWeek) {
                                driver.balanceAtStartOfWeek = 0;
                                driver.streakAtStartOfWeek = 0;
                            } else {
                                driver.balanceAtStartOfWeek = runningBalance;
                                driver.streakAtStartOfWeek = oldStreakInWeeks;
                            }
                            break;
                        }
    
                        if (resetTriggeredThisWeek) {
                            runningBalance = 0;
                        } else {
                            if (newStreakInWeeks > oldStreakInWeeks) {
                                for (let i = oldStreakInWeeks + 1; i <= newStreakInWeeks; i++) {
                                    if (i === settings.timeOffStartAfterWeeks) {
                                        runningBalance += settings.timeOffBaseDays;
                                    } else if (i > settings.timeOffStartAfterWeeks) {
                                        runningBalance += (1 / (settings.timeOffWeeksPerDay || 1));
                                    }
                                }
                            }
                            runningBalance -= daysOffInWeek;
                            if (runningBalance < 0) {
                                runningBalance = 0;
                            }
                        }
                    }
    
                } else { // fullWeeksOnly
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
                            if (hasNotStartedInWeek) {
                                driver.weeksOut = 0; 
                                driver.balanceAtStartOfWeek = 0;
                                driver.streakAtStartOfWeek = 0;
                            } else {
                                driver.balanceAtStartOfWeek = runningBalance;
                                driver.streakAtStartOfWeek = streak;
                            }
                            break;
                        }
    
                        if (hasNotStartedInWeek) {
                            streak = 0;
                            runningBalance = 0;
                        } else {
                            const oldStreak = streak;
                            if (settings.weeksOutResetOnDaysOff && !weekMetCriteria) {
                                streak = 0;
                            } else if (weekMetCriteria) {
                                streak++;
                            }
                            if (streak > oldStreak) {
                                for (let i = oldStreak + 1; i <= streak; i++) {
                                    if (i === settings.timeOffStartAfterWeeks) {
                                        runningBalance += settings.timeOffBaseDays;
                                    } else if (i > settings.timeOffStartAfterWeeks) {
                                        runningBalance += (1 / (settings.timeOffWeeksPerDay || 1));
                                    }
                                }
                            }
                            runningBalance -= daysOffInWeek;
                            if (runningBalance < 0) {
                                runningBalance = 0;
                            }
                        }
                    }
                }
        });
    }

        // Percentile Calculations (No changes needed here)
        driversForDate.forEach(driver => {
            const payDate = driver.pay_date.split('T')[0];
            const overrideKey = `${driver.id}_${payDate}`;
            const distanceSource = overriddenDistances[overrideKey] || 'milesWeek';
            driver.distanceSource = distanceSource; 
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