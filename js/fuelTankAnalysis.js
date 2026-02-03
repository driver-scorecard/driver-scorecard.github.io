/**
 * fuelTankAnalysis.js
 *
 * Contains all logic for the global, truck-centric fuel tank analysis.
 * 1. Merges all historical data.
 * 2. Groups merged data by truck.
 * 3. Runs analysis on each truck.
 */

/**
 * Merges hourly MPG data with discrete fuel purchase events for a single driver.
 * (This function is moved from ui.js)
 * @param {Array<Object>} mpgData Hourly data from Samsara.
 * @param {Array<Object>} fuelPurchaseData Fuel purchase events.
 * @returns {Object} Contains merged { mpgData, unmatchedPurchases }.
 */
export function mergeFuelData(mpgData, fuelPurchaseData) {
    // --- 1. SETUP ---
    if (!fuelPurchaseData || fuelPurchaseData.length === 0) {
        return { mpgData, unmatchedPurchases: [] };
    }

    const mpgDataMap = new Map(
        mpgData
            .filter(d => d.hour_timestamp) // Ensure record has a timestamp
            .map(d => {
                const hourlyDate = new Date(d.hour_timestamp);
                hourlyDate.setUTCMinutes(0, 0, 0);
                const key = hourlyDate.toISOString();
                return [key, d];
            })
    );

    const unmatchedPurchases = [];

    // --- 2. MATCHING LOGIC ---
    const validFuelPurchases = fuelPurchaseData.filter(p => p.date);

    validFuelPurchases.forEach(purchase => {
        const purchaseDate = new Date(purchase.date);
        const targetHourTimestamp = new Date(purchaseDate);
        targetHourTimestamp.setUTCMinutes(0, 0, 0);
        const targetHourString = targetHourTimestamp.toISOString();

        let targetRecord = mpgDataMap.get(targetHourString);

        if (targetRecord) {
            const primaryFuelMovement = parseFloat(targetRecord.fuel_movement);
            if (primaryFuelMovement <= 0) {
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
 * Analyzes matched fueling events to find the median implied tank sizes.
 * (This function is moved from ui.js)
 * @param {Array<Object>} mergedTruckData - The hourly data for *one truck*.
 * @returns {Object} An object containing median sizes and event count.
 */
function calculateTankSizeAnalysis(mergedTruckData) {
    const systemSizes = [];
    const purchaseSizes = [];
    let eventCount = 0;

    mergedTruckData.forEach(row => {
        const purchaseGal = parseFloat(row.fuelUp_Quantity);
        const telematicsGal = parseFloat(row.fuel_spent);
        const telematicsPct = parseFloat(row.fuel_movement);

        if (purchaseGal > 0 && telematicsPct > 0 && telematicsGal > 0) {
            eventCount++;
            
            const systemImpliedSize = telematicsGal / (telematicsPct / 100);
            const purchaseImpliedSize = purchaseGal / (telematicsPct / 100);

            if (systemImpliedSize > 20 && systemImpliedSize < 500) {
                systemSizes.push(systemImpliedSize);
            }
            if (purchaseImpliedSize > 20 && purchaseImpliedSize < 500) {
                purchaseSizes.push(purchaseImpliedSize);
            }
        }
    });

    const getMedian = (arr) => {
        if (arr.length === 0) return 0;
        arr.sort((a, b) => a - b);
        const mid = Math.floor(arr.length / 2);
        return arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    };

    return {
        medianSystemSize: getMedian(systemSizes),
        medianPurchaseSize: getMedian(purchaseSizes),
        eventCount: eventCount
    };
}

/**
 * Main analysis function.
 * Takes all cached data, merges it, groups by truck, and runs analysis.
 * @param {Object} allHourlyDataByDriver - The raw cached data from UNIFIED_HISTORY_URL
 * @param {Object} allPurchaseDataByDriver - The raw cached data from UNIFIED_HISTORY_URL
 * @returns {Array<Object>} An array of analysis results, one object per truck.
 */
export function runTruckFuelAnalysis(allHourlyDataByDriver, allPurchaseDataByDriver) {
    // 1. Merge all data by driver first
    const allMergedRecords = [];
    for (const driverName in allHourlyDataByDriver) {
        const hourlyData = allHourlyDataByDriver[driverName] || [];
        const purchaseData = allPurchaseDataByDriver[driverName] || [];
        
        // Use the merge function to get all hourly records, some now with purchase data
        const { mpgData } = mergeFuelData(hourlyData, purchaseData);
        
        // --- ADDED THIS ---
        // Stamp the driver name onto each record so we can track it
        mpgData.forEach(record => {
            record.driverName = driverName;
        });
        // --- END ADDITION ---

        allMergedRecords.push(...mpgData);
    }

    // 2. Now, group all merged records by truck
    const truckMap = allMergedRecords.reduce((acc, row) => {
        const truckId = row.truck_unit_id;
        // Skip records with no truck ID
        if (!truckId) {
            return acc;
        }
        if (!acc[truckId]) {
            acc[truckId] = [];
        }
        acc[truckId].push(row);
        return acc;
    }, {});

    // 3. Run analysis for each truck
    const finalReport = [];
    for (const [truckId, truckData] of Object.entries(truckMap)) {
        const analysis = calculateTankSizeAnalysis(truckData);
        
        // --- ADD THIS ---
        // Get unique driver names for this truck
        const driversSet = new Set(truckData.map(row => row.driverName).filter(Boolean));
        const driversList = Array.from(driversSet).sort();
        // --- END ADDITION ---

        if (analysis.eventCount > 0) {
            const diff = analysis.medianPurchaseSize - analysis.medianSystemSize;
            const diffPct = (analysis.medianSystemSize !== 0) ? (diff / analysis.medianSystemSize) : 0;

            finalReport.push({
                truckId: truckId,
                drivers: driversList, // <-- ADDED
                eventCount: analysis.eventCount,
                medianSystemSize: analysis.medianSystemSize,
                medianPurchaseSize: analysis.medianPurchaseSize,
                discrepancyGallons: diff,
                discrepancyPercent: diffPct * 100
            });
        }
    }

    // 4. Sort by the worst offenders (largest absolute discrepancy)
    finalReport.sort((a, b) => Math.abs(b.discrepancyPercent) - Math.abs(a.discrepancyPercent));
    
    return finalReport;
}