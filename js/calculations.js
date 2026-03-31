// TPOG/js/calculations.js

export function getContractStatusForDay(driverName, dayString, allContracts) {
    const contracts = allContracts ? allContracts[driverName] : null;
    if (!contracts || contracts.length === 0) return 'ACTIVE'; // Fallback if no contract data exists

    const currentDay = new Date(dayString + 'T12:00:00Z');

    // If before the very first contract
    const firstStart = new Date(contracts[0].start + 'T12:00:00Z');
    if (currentDay < firstStart) return 'NOT_STARTED';

    for (let i = 0; i < contracts.length; i++) {
        const contract = contracts[i];
        const start = new Date(contract.start + 'T12:00:00Z');
        
        let end = null;
        if (contract.end) {
            end = new Date(contract.end + 'T12:00:00Z');
        }

        if (currentDay >= start && (!end || currentDay <= end)) {
            return 'ACTIVE'; // In an active contract period
        }
    }

    // If it's after the first start, but not in any active window, it's ended
    return 'CONTRACT_ENDED';
}

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

    // --- CHECK EXCLUSIONS ---
    const ignoreAll = driver.ignoreAll === true || driver.ignoreAll === 'true';
    const ignoreWeeksOut = ignoreAll || (driver.ignoreWeeksOut === true || driver.ignoreWeeksOut === 'true');
    const ignoreSafety = ignoreAll || (driver.ignoreSafety === true || driver.ignoreSafety === 'true');
    const ignoreFuel = ignoreAll || (driver.ignoreFuel === true || driver.ignoreFuel === 'true');
    const ignoreTenure = ignoreAll || (driver.ignoreTenure === true || driver.ignoreTenure === 'true');
    const ignoreGross = ignoreAll || (driver.ignoreGrossBonus === true || driver.ignoreGrossBonus === 'true');

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
        // UPDATED: Use peak streak for earning calculation if available
        const currentStreak = (driver.peakWeeksOut !== undefined) ? driver.peakWeeksOut : (driver.weeksOut || 0);

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
            // FIX: Check against 'currentAvailable' (total budget), not just 'balanceAtStartOfWeek'
            const excessDays = Math.max(0, daysTakenThisWeek - Math.max(0, currentAvailable));
            report.escrowDeduct = excessDays * (settings.escrowDeductionAmount || 0);
        }
        
        report.totalPositiveBonuses = 0;
        report.totalPenalties = 0;
        report.bonuses['Weeks Out'] = { bonus: 0 };
        report.bonuses['Safety Score'] = { bonus: 0 };
        report.bonuses['Speeding Penalty'] = { bonus: 0 };
        report.bonuses['Fuel Efficiency'] = { bonus: 0 };
        report.bonuses['Tenure'] = { bonus: 0 };
        report.bonuses['Gross Target'] = { bonus: 0 };

        return report;
    }
    // --- END OF NEW CHECK ---


    // Check if an override for escrowDeduct exists on the driver object.
    if (driver.hasOwnProperty('escrowDeduct')) {
        report.escrowDeduct = parseFloat(driver.escrowDeduct) || 0;
    }

    // Weeks Out Bonus
    if (settings.enabledMetrics?.weeksOut ?? true) {
        const weeksOutDetails = getTieredBonusDetails(driver.weeksOut, settings.weeksOutTiers);
        const val = weeksOutDetails.bonus;
        if (ignoreWeeksOut) {
            report.bonuses['Weeks Out'] = { bonus: 0, potentialBonus: val, ignored: true };
        } else {
            report.bonuses['Weeks Out'] = { bonus: val };
            report.totalBonus += val;
        }
    } else {
        report.bonuses['Weeks Out'] = { bonus: 0 };
    }

    // Safety Score Bonus & Speeding Penalty
    if (settings.enabledMetrics?.safety ?? true) {
        // 1. Calculate Safety Score
        let safetyBonus = 0;
        const scoreMet = driver.safetyScore >= settings.safetyScoreThreshold;
        const milesMet = driver.stubMiles >= settings.safetyScoreMileageThreshold;
        const hasSpeedingAlerts = driver.speedingAlerts > 0;
        if (settings.safetyBonusForfeitedOnSpeeding && hasSpeedingAlerts && scoreMet && milesMet) {
            safetyBonus = 0;
        } else if (scoreMet && milesMet) {
            safetyBonus = settings.safetyScoreBonus;
        }

        // 2. Calculate Speeding Penalty
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

        // 3. Apply or Ignore
        if (ignoreSafety) {
            report.bonuses['Safety Score'] = { bonus: 0, potentialBonus: safetyBonus, ignored: true };
            report.bonuses['Speeding Penalty'] = { bonus: 0, potentialBonus: speedingPenalty, ignored: true };
        } else {
            report.bonuses['Safety Score'] = { bonus: safetyBonus };
            report.totalBonus += safetyBonus;
            report.bonuses['Speeding Penalty'] = { bonus: speedingPenalty };
            report.totalBonus += speedingPenalty;
        }

    } else {
        report.bonuses['Safety Score'] = { bonus: 0 };
        report.bonuses['Speeding Penalty'] = { bonus: 0 };
    }

    // Fuel Efficiency Bonus
    if (settings.enabledMetrics?.fuel ?? true) {
        let fuelBonus = 0;
        let infoText = 'Fuel bonus not applicable.';
        const fuelMileageThreshold = settings.fuelMileageThreshold || 0;
        const driverMiles = driver.stubMiles || 0;

        if (driverMiles >= fuelMileageThreshold && driver.mpg > 0) {
            const percentileDetails = getTieredBonusDetails(driver.mpgPercentile, settings.mpgPercentileTiers);
            fuelBonus = percentileDetails.bonus;

            // InfoText Calculation
            const currentMpg = parseFloat(driver.mpg);
            const sortedTiers = [...settings.mpgPercentileTiers].sort((a, b) => a.threshold - b.threshold);
            let targetTier = null;
            
            if (fuelBonus < 0) {
                targetTier = sortedTiers.find(t => t.bonus >= 0);
            } else {
                targetTier = sortedTiers.find(t => t.bonus > fuelBonus);
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
                    if (fuelBonus < 0) {
                        infoText = `Reach ${targetMpg.toFixed(1)} MPG to remove the penalty.`;
                    } else {
                        infoText = `Reach ${targetMpg.toFixed(1)} MPG for a +${targetTier.bonus.toFixed(1)}% bonus.`;
                    }
                } else {
                    infoText = 'Keep up the great work!';
                }
            } else if (targetTier) {
                // Change "percentile" to "Top X%"
                infoText = fuelBonus < 0 ? 'Improve MPG to remove penalty.' : `Reach the Top ${100 - targetTier.threshold}% of the fleet for the next bonus.`;
            } else {
                infoText = 'Maximum fuel bonus reached.';
            }

        } else if (driverMiles < fuelMileageThreshold) {
            infoText = `Drive ${fuelMileageThreshold} miles to qualify for fuel bonus.`;
        } else if (driver.mpg <= 0) {
            infoText = 'No MPG data available to calculate bonus.';
        }
        
        let shouldIgnoreFuel = ignoreFuel;
        const userExplicitlyUncheckedFuel = driver.ignoreFuel === false || driver.ignoreFuel === 'false';
        
        // Auto-ignore if the week is partial AND the bonus is a penalty (negative)
        if (driver.hasNotStartedInWeek && fuelBonus < 0 && !userExplicitlyUncheckedFuel) {
            shouldIgnoreFuel = true;
            infoText = 'Penalty ignored (partial week).';
        }

        if (shouldIgnoreFuel) {
            report.bonuses['Fuel Efficiency'] = { bonus: 0, potentialBonus: fuelBonus, infoText: infoText, ignored: true };
        } else {
            report.bonuses['Fuel Efficiency'] = { bonus: fuelBonus, infoText: infoText };
            report.totalBonus += fuelBonus;
        }
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
        
        if (ignoreTenure) {
            report.bonuses['Tenure'] = { bonus: 0, potentialBonus: tenureBonus, ignored: true };
        } else {
            report.bonuses['Tenure'] = { bonus: tenureBonus };
            report.totalBonus += tenureBonus;
        }
    } else {
        report.bonuses['Tenure'] = { bonus: 0 };
    }

    // Gross Target Bonus
    if (settings.enabledMetrics?.grossTarget ?? true) {
        let grossBonus = 0;
        const sortedTiers = (settings.grossTargetTiers || []).sort((a, b) => a.from - b.from);
        for (const tier of sortedTiers) {
            const from = tier.from;
            const to = tier.to || Infinity;
            if (driver.gross >= from && driver.gross <= to) {
                grossBonus = tier.bonus;
                break; 
            }
        }

        let shouldIgnoreGross = ignoreGross;
        const userExplicitlyUncheckedGross = driver.ignoreGrossBonus === false || driver.ignoreGrossBonus === 'false';
        
        // Auto-ignore if the week is partial AND the bonus is a penalty (negative)
        if (driver.hasNotStartedInWeek && grossBonus < 0 && !userExplicitlyUncheckedGross) {
            shouldIgnoreGross = true;
        }

        if (shouldIgnoreGross) {
            report.bonuses['Gross Target'] = { bonus: 0, potentialBonus: grossBonus, ignored: true };
        } else {
            report.bonuses['Gross Target'] = { bonus: grossBonus };
            report.totalBonus += grossBonus;
        }
    } else {
        report.bonuses['Gross Target'] = { bonus: 0 };
    }

    // Separate Bonuses and Penalties
    report.totalPositiveBonuses = Object.values(report.bonuses).reduce((sum, { bonus }) => sum + Math.max(0, bonus), 0);
    report.totalPenalties = Object.values(report.bonuses).reduce((sum, { bonus }) => sum + Math.min(0, bonus), 0);
    
    report.bonusesInDollars = (report.totalPositiveBonuses / 100) * grossPay;
    report.penaltiesInDollars = (report.totalPenalties / 100) * grossPay;

    const daysTakenThisWeek = driver.offDays || 0;
    const balanceAtStartOfWeek = driver.balanceAtStartOfWeek || 0;
    const streakAtStartOfWeek = driver.streakAtStartOfWeek || 0;
    // UPDATED: Use peak streak for earning calculation if available
    const currentStreak = (driver.peakWeeksOut !== undefined) ? driver.peakWeeksOut : (driver.weeksOut || 0);

    let newlyEarnedThisWeek = 0;
    const startThreshold = settings.timeOffStartAfterWeeks || 3;
    const weeksPerDay = settings.timeOffWeeksPerDay || 1;

    // Check if the threshold was crossed during this week
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

    // Only calculate escrow if an override hasn't already set the value.
    if (!driver.hasOwnProperty('escrowDeduct')) {
        // FIX: Check against 'currentAvailable' (total budget), not just 'balanceAtStartOfWeek'
        const excessDays = Math.max(0, daysTakenThisWeek - Math.max(0, currentAvailable));
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
// Helper to calculate median safely
function getMedian(values) {
    if (values.length === 0) return 0;
    // Create a copy to avoid sorting the original array references
    const sorted = [...values].sort((a, b) => a - b);
    const half = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2) {
        return sorted[half]; // Odd length
    }
    return (sorted[half - 1] + sorted[half]) / 2.0; // Even length
}

export function processDriverDataForDate(driversForDate, mileageIndex, settings, safetyIndex, overriddenDistances, daysTakenIndex, dispatcherOverrides, allDrivers, mpgOverrides, allLockedData = {}, allContracts = {}) {
    if (driversForDate.length > 0) {
        const formatDate = (date) => date.toISOString().split('T')[0];
        const selectedDateStr = driversForDate[0].pay_date.split('T')[0];

       driversForDate.forEach(driver => {
        // --- Company Swap Logic ---
        if (allDrivers) {
            const allDriverRecords = allDrivers
                .filter(d => d.name === driver.name && d.pay_date)
                .sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date)); // Sort descending
            
            const prevRecord = allDriverRecords.find(d => d.pay_date.split('T')[0] < selectedDateStr);
            
            const currentCompany = (driver.company || '').trim();
            const prevCompany = prevRecord ? (prevRecord.company || '').trim() : '';

            if (prevRecord && prevCompany && currentCompany && prevCompany !== currentCompany) {
                driver.changedCompany = true;
                driver.previousCompany = prevCompany;
            } else {
                driver.changedCompany = false;
            }
        }
        // --------------------------

        // --- Underperformer Logic (Tiered Sums AND Fixed Median) ---
        // 1. LOCKED WEEKS ONLY
        // 2. TPOG ONLY
        // 3. EXCLUDE INACTIVE
        // 4. USE SNAPSHOT DATA (Important!)
        if (allDrivers && allLockedData) {
            
            // Get all records for this driver (by name, for TPOG)
            const driverHistory = allDrivers.filter(d => d.name === driver.name && d.contract_type === 'TPOG');
            
            const validHistorySnapshots = [];

            // Iterate through history to find valid locked snapshots
            driverHistory.forEach(d => {
                const pDateStr = d.pay_date.split('T')[0];
                
                // Exclude future weeks
                if (pDateStr > selectedDateStr) return;

                const lockedJSON = allLockedData[`${d.id}_${pDateStr}`];
                
                if (lockedJSON) {
                    try {
                        const snapshot = JSON.parse(lockedJSON);
                        
                        // Check for fully inactive status
                        if (snapshot.weeklyActivity && Array.isArray(snapshot.weeklyActivity)) {
                            const isFullyInactive = snapshot.weeklyActivity.every(day => {
                                const status = (day.statuses || '').toUpperCase();
                                return status.includes('NOT_STARTED') || status.includes('CONTRACT_ENDED');
                            });
                            
                            // Only add if active
                            if (!isFullyInactive) {
                                validHistorySnapshots.push({
                                    pay_date: pDateStr,
                                    gross: parseFloat(snapshot.gross) || 0,
                                    stubMiles: parseFloat(snapshot.stubMiles) || 0
                                });
                            }
                        }
                    } catch (e) {
                        console.warn("Error parsing locked data:", e);
                    }
                }
            });

            const count = validHistorySnapshots.length;

            // 3. Minimum 4 valid locked weeks required
            if (count >= 4) {
                // Sort descending by date
                validHistorySnapshots.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));

                // Determine Thresholds
                let weeksToCheck = 0;
                let minGrossSum = 0;
                let minMilesSum = 0;

                if (count >= 6) {
                    weeksToCheck = 6;
                    minGrossSum = 30000;
                    minMilesSum = 12000;
                } else if (count === 5) {
                    weeksToCheck = 5;
                    minGrossSum = 25000;
                    minMilesSum = 10000;
                } else { 
                    weeksToCheck = 4;
                    minGrossSum = 20000;
                    minMilesSum = 8000;
                }

                // Slice the SNAPSHOTS
                const recentHistory = validHistorySnapshots.slice(0, weeksToCheck);
                
                // --- Condition A: Sum Check (Using Snapshot Values) ---
                const sumGross = recentHistory.reduce((sum, d) => sum + d.gross, 0);
                const sumMiles = recentHistory.reduce((sum, d) => sum + d.stubMiles, 0);
                
                const isSumFailing = (sumGross < minGrossSum || sumMiles < minMilesSum);

                // --- Condition B: Median Check (Using Snapshot Values) ---
                const grossValues = recentHistory.map(d => d.gross);
                const milesValues = recentHistory.map(d => d.stubMiles);
                
                const medianGross = getMedian(grossValues);
                const medianMiles = getMedian(milesValues);

                const isMedianFailing = (medianGross <= 6000 || medianMiles <= 2500);

                // --- Final Decision ---
                if (isSumFailing && isMedianFailing) {
                    driver.isUnderperformer = true;
                    let reasons = [];
                    
                    reasons.push(`(Last ${weeksToCheck} wks)`);
                    
                    if (sumGross < minGrossSum) reasons.push(`Sum Gross $${Math.round(sumGross)} < $${minGrossSum}`);
                    if (sumMiles < minMilesSum) reasons.push(`Sum Miles ${Math.round(sumMiles)} < ${minMilesSum}`);
                    
                    if (medianGross <= 6000) reasons.push(`Median Gross $${Math.round(medianGross)} <= $6000`);
                    if (medianMiles <= 2500) reasons.push(`Median Miles ${Math.round(medianMiles)} <= 2500`);

                    driver.underperformerReason = `Underperformer:\n` + reasons.join('\n');
                }
            }
        }
        // ----------------------------

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
            } else if (overrideStatus === 'NOT_STARTED' || overrideStatus === 'CONTRACT_ENDED') {
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
        const weeklyMileageRecords = driverMileageRecords.filter(m => {
            const mDateStr = m.date.split('T')[0]; 
            return mDateStr >= tuesdayStr && mDateStr <= mondayStr;
        });

        // Calculate total miles
        driver.milesWeek = Math.round(weeklyMileageRecords.reduce((total, record) => total + (record.movement || 0), 0));
        
        // NEW: Set flag for ProLogs icon (Only true if actual records exist)
        driver.hasPrologsData = weeklyMileageRecords.length > 0; 

        if (safetyIndex) {
            const driverSafetyRecords = safetyIndex[driver.name] || [];
            const performanceDateStr = formatDate(performanceDate);
            const safetyRecord = driverSafetyRecords.find(record => record.date.split('T')[0] === performanceDateStr);
            
            if (safetyRecord && safetyRecord.totalDistance) {
                driver.samsaraDistance = Math.round(parseFloat(safetyRecord.totalDistance));
            }
            // NEW: Set flag for Samsara icon (Only true if actual record exists)
            driver.hasSamsaraData = !!safetyRecord;
        } else {
            driver.hasSamsaraData = false;
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

        let lastKnownStatus = 'NO DATA';

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
            
            // Check Contract Status first
            const contractStatus = getContractStatusForDay(driver.name, dayString, allContracts);

            // --- FIX: Use strict string comparison (YYYY-MM-DD) for status lookup ---
            let statusesForDay = driverDaysOffHistory
                .filter(log => formatDate(new Date(log.date)) === dayString)
                .map(log => {
                    let st = log.activity_status;
                    if (st === 'WITHOUT_LOAD' || st === 'WITHOUT LOAD') return 'ACTIVE';
                    return st;
                });
            // -----------------------------------------------------------------------

            const uniqueStatuses = [...new Set(statusesForDay)];
            let systemStatusText = uniqueStatuses.length > 0 ? uniqueStatuses.join(', ') : 'NO DATA';
            
            // Carry-forward OR Contract Status Logic
            if (contractStatus !== 'ACTIVE') {
                systemStatusText = contractStatus;
                lastKnownStatus = 'NO DATA'; // Reset carry-forward if contract drops
            } else {
                if (systemStatusText === 'NO DATA' && lastKnownStatus !== 'NO DATA') {
                    systemStatusText = lastKnownStatus;
                } else if (systemStatusText !== 'NO DATA') {
                    lastKnownStatus = systemStatusText;
                }
            }

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
            // Get raw system logs for live checks
            const driverDaysOffHistory = daysTakenIndex[driver.name] || [];
            
            // Make mileage records accessible for this loop
            const driverMileageRecords = mileageIndex[driver.name] || [];
            
            const allRecordsForDriver = allDrivers
                .filter(d => d.name === driver.name && d.pay_date)
                .sort((a, b) => new Date(a.pay_date) - new Date(b.pay_date));

            let runningBalance = 0; 
            let streak = 0;
            const payDatesProcessed = new Set();
            const dailyContribution = 0.1429;
    
            let continuousDayStreak = 0; 

        for (const record of allRecordsForDriver) {
            const recordPayDateStr = record.pay_date.split('T')[0];
            if (payDatesProcessed.has(recordPayDateStr)) continue;
            payDatesProcessed.add(recordPayDateStr);
            
            // --- FIX: Ignore weeks where contract is not TPOG ---
            if (record.contract_type !== 'TPOG') {
                continuousDayStreak = 0; // Reset streak if they left TPOG
                streak = 0;
                
                if (recordPayDateStr === selectedDateStr) {
                    driver.weeksOut = 0;
                    driver.peakWeeksOut = 0;
                    driver.balanceAtStartOfWeek = runningBalance;
                    driver.streakAtStartOfWeek = 0;
                    driver.offDays = 0;
                    break;
                }
                continue; // Skip calculation for this week
            }
            // ----------------------------------------------------
            
            const performanceDate = new Date(recordPayDateStr + 'T12:00:00Z');
                if (record.pay_delayWks === 2) performanceDate.setUTCDate(performanceDate.getUTCDate() - 7);
                
                const monday = new Date(performanceDate);
                monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
                const tuesday = new Date(monday);
                tuesday.setUTCDate(monday.getUTCDate() - 6);

                const oldStreakInWeeks = settings.weeksOutMethod === 'dailyAccrual' 
                    ? Math.floor(continuousDayStreak * dailyContribution) 
                    : streak;
                
                let maxDaysThisWeek = continuousDayStreak;
                let daysOffInWeek = 0;
                let hasNotStartedInWeek = false;
                let resetTriggeredThisWeek = false;

                // --- 1. Check for Locked Snapshot ---
                // FIX: Look at locked data to ensure historical loop matches the UI perfectly
                const lockedJSON = allLockedData[`${record.id}_${recordPayDateStr}`];
                let lockedActivity = null;
                let snapshotOffDays = null;
                if (lockedJSON) {
                    try {
                        const snapshot = JSON.parse(lockedJSON);
                        if (snapshot.weeklyActivity && snapshot.weeklyActivity.length === 7) {
                            lockedActivity = snapshot.weeklyActivity;
                        }
                        if (snapshot.offDays !== undefined) {
                            snapshotOffDays = snapshot.offDays;
                        }
                    } catch(e) {}
                }

                // --- 2. Process the 7 Days ---
                let lastKnownHistoryStatus = 'NO DATA';
                for (let i = 0; i < 7; i++) {
                    const currentDay = new Date(tuesday);
                    currentDay.setUTCDate(tuesday.getUTCDate() + i);
                    const dayString = formatDate(currentDay);
                    
                    let isDayOff = false;
                    let isNotStarted = false;
                    let isContractEnded = false;

                    if (lockedActivity) {
                        // Trust the snapshot reality so the UI perfectly matches the math
                        const dayAct = lockedActivity[i];
                        let combinedStr = ((dayAct.statuses || '') + ' ' + (dayAct.tooltipStatus || '')).toUpperCase();
                        
                        // Force WITHOUT_LOAD to ACTIVE
                        if (combinedStr.includes('WITHOUT_LOAD') || combinedStr.includes('WITHOUT LOAD')) {
                            combinedStr = combinedStr.replace(/WITHOUT_?LOAD/g, 'ACTIVE');
                        }

                        if (combinedStr.includes('NOT_STARTED')) {
                            isNotStarted = true;
                        } else if (combinedStr.includes('CONTRACT_ENDED')) {
                            isContractEnded = true;
                        } else if (combinedStr.includes('DAY_OFF') || combinedStr.includes('TIME_OFF') || combinedStr.includes('DAY OFF')) {
                            isDayOff = true;
                        } else if (!combinedStr.includes('ACTIVE') && !combinedStr.includes('NO DATA') && dayAct.mileage === 0) {
                            // Catches other unhandled status strings that resulted in red UI blocks
                            isDayOff = true; 
                        }
                        
                        // If it has miles, the UI forced it to green (unless explicitly DAY OFF)
                        if (dayAct.mileage > 0 && !combinedStr.includes('DAY_OFF') && !combinedStr.includes('DAY OFF')) {
                            isDayOff = false;
                        }
                    } else {
                        // Check Contract
                        const contractStatus = getContractStatusForDay(driver.name, dayString, allContracts);

                        // Live Logic - Reading raw system logs directly to avoid missing TIME_OFF
                        let statusesForDay = driverDaysOffHistory
                            .filter(log => formatDate(new Date(log.date)) === dayString)
                            .map(log => {
                                let st = (log.activity_status || '').toUpperCase();
                                if (st === 'WITHOUT_LOAD' || st === 'WITHOUT LOAD') return 'ACTIVE';
                                return st;
                            });
                        
                        let combinedLiveStr = statusesForDay.length > 0 ? statusesForDay.join(' ') : 'NO DATA';
                        
                        // Contract / Carry-forward logic
                        if (contractStatus !== 'ACTIVE') {
                            combinedLiveStr = contractStatus;
                            lastKnownHistoryStatus = 'NO DATA';
                        } else {
                            if (combinedLiveStr === 'NO DATA' && lastKnownHistoryStatus !== 'NO DATA') {
                                combinedLiveStr = lastKnownHistoryStatus;
                            } else if (combinedLiveStr !== 'NO DATA') {
                                lastKnownHistoryStatus = combinedLiveStr;
                            }
                        }

                        const overrideKey = `${driver.name}_${dayString}`;
                        const overrideStatus = dispatcherOverrides[overrideKey];
                        
                        // Set boolean flags
                        isNotStarted = overrideStatus === 'NOT_STARTED' || combinedLiveStr.includes('NOT_STARTED');
                        isContractEnded = overrideStatus === 'CONTRACT_ENDED' || combinedLiveStr.includes('CONTRACT_ENDED');
                        
                        // Get mileage for this historical day
                        const mileageForDay = driverMileageRecords
                            .filter(m => m.date.split('T')[0] === dayString)
                            .reduce((sum, m) => sum + (m.movement || 0), 0);

                        if (overrideStatus === 'DAY_OFF') {
                            isDayOff = true;
                        } else if (overrideStatus !== 'CORRECT' && overrideStatus !== undefined) {
                            isDayOff = false; // explicitly active
                        } else if (combinedLiveStr.includes('DAY_OFF') || combinedLiveStr.includes('TIME_OFF') || combinedLiveStr.includes('DAY OFF')) {
                            isDayOff = true; // System designated off
                        } else if (!combinedLiveStr.includes('ACTIVE') && !combinedLiveStr.includes('NO DATA') && !isNotStarted && !isContractEnded && mileageForDay === 0) {
                            // Catch all for unhandled statuses that result in red UI blocks (skip if contract is inactive)
                            isDayOff = true;
                        }

                        if (mileageForDay > 0 && !combinedLiveStr.includes('DAY_OFF') && !combinedLiveStr.includes('DAY OFF')) {
                            isDayOff = false;
                        }
                    }

                    if (isDayOff) daysOffInWeek++;
                    if (isNotStarted) hasNotStartedInWeek = true;
                    if (isNotStarted || isContractEnded) resetTriggeredThisWeek = true;

                    // Daily Accrual Streak Loop Logic
                    if (settings.weeksOutMethod === 'dailyAccrual') {
                        if ((settings.weeksOutResetOnDaysOff && isDayOff) || isNotStarted || isContractEnded) {
                            continuousDayStreak = 0;
                        } else if (!isDayOff) {
                            continuousDayStreak++;
                        }
                        if (continuousDayStreak > maxDaysThisWeek) maxDaysThisWeek = continuousDayStreak;
                    }
                }

                // Full Weeks Only Loop Logic
                let weekMetCriteria = daysOffInWeek === 0 && !hasNotStartedInWeek;
                if (settings.weeksOutMethod === 'fullWeeksOnly') {
                    if (hasNotStartedInWeek) {
                        streak = 0;
                    } else if (settings.weeksOutResetOnDaysOff && !weekMetCriteria) {
                        streak = 0;
                    } else if (weekMetCriteria) {
                        streak++;
                    }
                }

                // --- 3. Finalize if Target Week ---
                if (recordPayDateStr === selectedDateStr) {
                    if (settings.weeksOutMethod === 'dailyAccrual') {
                        driver.weeksOut = continuousDayStreak * dailyContribution;
                        driver.peakWeeksOut = maxDaysThisWeek * dailyContribution;
                        driver.balanceAtStartOfWeek = resetTriggeredThisWeek ? 0 : runningBalance;
                        driver.streakAtStartOfWeek = resetTriggeredThisWeek ? 0 : oldStreakInWeeks;
                    } else {
                        driver.weeksOut = weekMetCriteria ? oldStreakInWeeks + 1 : oldStreakInWeeks;
                        driver.peakWeeksOut = driver.weeksOut;
                        driver.balanceAtStartOfWeek = hasNotStartedInWeek ? 0 : runningBalance;
                        driver.streakAtStartOfWeek = hasNotStartedInWeek ? 0 : oldStreakInWeeks;
                    }
                    // Write live off days count
                    driver.offDays = daysOffInWeek;
                    // Tag the driver if they have NOT_STARTED this week (ignore negative gross/fuel if true)
                    driver.hasNotStartedInWeek = hasNotStartedInWeek; 
                    break;
                }

                // --- 4. Process Historical Deductions & Accruals ---
                if (settings.weeksOutMethod === 'dailyAccrual') {
                    if (resetTriggeredThisWeek) {
                        runningBalance = 0;
                    } else {
                        const newStreakInWeeks = Math.floor(continuousDayStreak * dailyContribution);
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
                        if (runningBalance < 0) runningBalance = 0;
                    }
                } else {
                    if (hasNotStartedInWeek) {
                        runningBalance = 0;
                    } else {
                        if (streak > oldStreakInWeeks) {
                            for (let i = oldStreakInWeeks + 1; i <= streak; i++) {
                                if (i === settings.timeOffStartAfterWeeks) {
                                    runningBalance += settings.timeOffBaseDays;
                                } else if (i > settings.timeOffStartAfterWeeks) {
                                    runningBalance += (1 / (settings.timeOffWeeksPerDay || 1));
                                }
                            }
                        }
                        runningBalance -= daysOffInWeek;
                        if (runningBalance < 0) runningBalance = 0;
                    }
                }
            }
        });
    }

        // Percentile & MPG Calculations
        driversForDate.forEach(driver => {
            const payDate = driver.pay_date.split('T')[0];
            const overrideKey = `${driver.id}_${payDate}`;
            const mpgKey = `${driver.id}_${payDate}`;

            // 1. Distance Calculation
            const distanceSource = overriddenDistances[overrideKey] || 'milesWeek';
            driver.distanceSource = distanceSource; 
            const distance = distanceSource === 'samsaraDistance' ? driver.samsaraDistance : driver.milesWeek;
            
            // 2. MPG Source Calculation
            const gallons = parseFloat(driver.gallons_fictive);
            // Calculate what the "Samsara" MPG would be
            const calculatedMpg = (gallons > 0 && distance > 0) ? (distance / gallons) : 0;
            
            // Determine Default Source: 'mpg' (Samsara) if available, otherwise 'stubMpg'
            let defaultMpgSource = (calculatedMpg > 0) ? 'mpg' : 'stubMpg';
            
            // Check for Override
            let activeMpgSource = defaultMpgSource;
            if (mpgOverrides && mpgOverrides[mpgKey]) {
                activeMpgSource = mpgOverrides[mpgKey];
            }
            driver.mpgSource = activeMpgSource;

            // 3. Set the final MPG value used for percentiles
            if (activeMpgSource === 'mpg') {
                driver.mpg = calculatedMpg;
            } else {
                driver.mpg = parseFloat(driver.stubMpg) || 0;
            }
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
