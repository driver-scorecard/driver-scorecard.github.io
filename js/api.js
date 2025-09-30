/**
 * api.js
 * * Handles all network requests to fetch and save data from Google Apps Script endpoints,
 * * with a session-based in-memory caching layer to improve performance during a single session.
 */

import {
    SETTINGS_SCRIPT_URL,
    DRIVER_DATA_URL,
    MILEAGE_DATA_URL,
    FUEL_HISTORY_URL,
    SAFETY_HISTORY_URL,
    PO_HISTORY_URL,
    FUEL_PURCHASE_HISTORY_URL,
    ALL_SAFETY_DATA_URL,
    DAYS_TAKEN_HISTORY_URL,
    DISTANCE_OVERRIDE_URL,
    UNIFIED_HISTORY_URL,
    CHANGELOG_URL,
    DISPATCHER_OVERRIDES_URL,
    FINANCIAL_DATA_URL
} from './config.js';

// --- Caching & Normalization Solution ---
const sessionCache = {};
let backgroundFetchPromise = null;

const normalizeDriverName = (name) => (name || '').trim().toLowerCase();

function getCachedData(key) {
    return sessionCache[key] || null;
}

function setCachedData(key, data) {
    sessionCache[key] = data;
}
// --- END Caching & Normalization Solution ---


export async function loadSettings() {
    const cacheKey = 'settings';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    try {
        const response = await fetch(SETTINGS_SCRIPT_URL);
        if (!response.ok) throw new Error('Network response for settings was not ok.');
        const settings = await response.json();
        setCachedData(cacheKey, settings);
        return settings;
    } catch (error) {
        console.error("Failed to fetch settings:", error);
        alert("ERROR: Failed to load calculation rules.");
        return null;
    }
}

export async function loadMileageData() {
    const cacheKey = 'mileageData';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    try {
        const response = await fetch(MILEAGE_DATA_URL);
        if (!response.ok) throw new Error('Network response for mileage data was not ok.');
        const result = await response.json();
        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch mileage data:", error);
        return [];
    }
}

export async function fetchDriverData() {
    const cacheKey = 'driverData';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    try {
        const response = await fetch(DRIVER_DATA_URL);
        const result = await response.json();
        const formattedData = result.data.map(d => ({
            id: d.contract_id, name: d.driver_name, dispatcher: d.dispatch || '-', team: d.team || '-',
            franchise: d.franchise || '-', company: d.company || '-', contract_type: d.contract_type || '-',
            weeksOut: 0, milesWeek: d.milesWeek || 0, tenure: d.tenure || 0, gross: d.gross || 0, stubMiles: 0, rpm: d.rpm || 0,
            estimatedNet: d.estimated_net || 0, safetyScore: d.safety_score || 0, speedingAlerts: d.speed_events || 0,
            speeding_over11mph: d.speeding_over11mph || 0, speeding_over16mph: d.speeding_over16mph || 0,
            mpg: parseFloat(d.gallons_fictive > 0 ? (d.distance / d.gallons_fictive) : 0).toFixed(1),
            pay_date: d.pay_date, bonuses: 0, penalties: 0,
            distance: d.distance || 0,
            gallons_fictive: d.gallons_fictive || 0,
            pay_delayWks: d.pay_delayWks || 1
        }));
        setCachedData(cacheKey, formattedData);
        return formattedData;
    } catch (error) {
        console.error("Failed to fetch driver data:", error);
        return null;
    }
}

export async function saveSettings(settings) {
    try {
        await fetch(SETTINGS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(settings)
        });
        sessionCache['settings'] = null;
    } catch (error) {
        console.warn("CORS error is expected here. Assuming script executed successfully.");
    }
}


export async function fetchSafetyHistory(driverName) {
    const normalizedName = normalizeDriverName(driverName);
    const cacheKey = `safetyHistory_${normalizedName}`;
    const cachedData = getCachedData(cacheKey);
    // If the cache has the data (either from the background fetch or a previous live fetch), return it.
    if (cachedData) {
        return Promise.resolve(cachedData);
    }

    // **RESTORED LOGIC**: If data is not in cache, perform the live fetch immediately. Do not wait.
    console.warn(`Cache miss for safety history. Performing live fetch for ${driverName}.`);
    const url = new URL(SAFETY_HISTORY_URL);
    url.searchParams.append('driverName', driverName);

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Network response was not ok. Status: ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error(`API Error: ${result.message}`);
        
        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch safety history (live):", error);
        return [];
    }
}

export async function fetchFuelHistory(driverName) {
    const normalizedName = normalizeDriverName(driverName);
    const cacheKey = `fuelHistory_${normalizedName}`;
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
        return Promise.resolve(cachedData);
    }

    console.warn(`Cache miss for fuel history. Performing live fetch for ${driverName}.`);
    const url = new URL(FUEL_HISTORY_URL);
    url.searchParams.append('driverId', driverName);

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Network response was not ok. Status: ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error(`API Error: ${result.message}`);
        
        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch fuel history (live):", error);
        return [];
    }
}


export async function loadAllSafetyData() {
    const cacheKey = 'allSafetyData';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    try {
        const response = await fetch(ALL_SAFETY_DATA_URL);
        if (!response.ok) throw new Error('Network response for all safety data was not ok.');
        const result = await response.json();
        if (!result.success) throw new Error(`API Error: ${result.message}`);

        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch all safety data:", error);
        return [];
    }
}

export async function fetchPOHistory(driverName) {
    const normalizedName = normalizeDriverName(driverName);
    const cacheKey = `poHistory_${normalizedName}`;
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
        return Promise.resolve(cachedData);
    }
    
    console.warn(`Cache miss for PO history. Performing live fetch for ${driverName}.`);
    const url = new URL(PO_HISTORY_URL);
    url.searchParams.append('driverName', driverName);

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Network response was not ok. Status: ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error(`API Error: ${result.message}`);
        
        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch PO history (live):", error);
        return [];
    }
}

export async function fetchFuelPurchaseHistory(driverName) {
    const normalizedName = normalizeDriverName(driverName);
    const cacheKey = `fuelPurchaseHistory_${normalizedName}`;
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
        return Promise.resolve(cachedData);
    }
    
    console.warn(`Cache miss for fuel purchase history. Performing live fetch for ${driverName}.`);
    const url = new URL(FUEL_PURCHASE_HISTORY_URL);
    url.searchParams.append('driverName', driverName);

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Network response was not ok. Status: ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error(`API Error: ${result.message}`);
        
        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch fuel purchase history (live):", error);
        return [];
    }
}

export async function fetchDaysTakenHistory() {
    const cacheKey = 'daysTakenHistory';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    try {
        const response = await fetch(DAYS_TAKEN_HISTORY_URL);
        if (!response.ok) throw new Error('Network response for days taken history was not ok.');
        const result = await response.json();
        if (!result.success) throw new Error(`API Error: ${result.message}`);
        
        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch days taken history:", error);
        return [];
    }
}

export async function fetchChangelogHistory(driverName) {
    const normalizedName = normalizeDriverName(driverName);
    const cacheKey = `changelogHistory_${normalizedName}`;
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
        return Promise.resolve(cachedData);
    }
    
    console.warn(`Cache miss for changelog history. Performing live fetch for ${driverName}.`);
    const url = new URL(CHANGELOG_URL);
    url.searchParams.append('driverName', driverName);

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Network response was not ok. Status: ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error(`API Error: ${result.message}`);
        
        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch changelog history (live):", error);
        return [];
    }
}

export async function loadDistanceOverrides() {
    const cacheKey = 'distanceOverrides';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    try {
        const response = await fetch(DISTANCE_OVERRIDE_URL);
        if (!response.ok) throw new Error('Network response for distance overrides was not ok.');
        const result = await response.json();
        if (!result.success) throw new Error(`API Error: ${result.message}`);
        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch distance overrides:", error);
        return {};
    }
}

export async function saveDistanceOverride(driverId, distanceSource, payDate) {
    try {
        await fetch(DISTANCE_OVERRIDE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ driverId, distanceSource, payDate })
        });
        sessionCache['distanceOverrides'] = null;
    } catch (error) {
        console.warn("CORS error is expected here. Assuming script executed successfully.");
    }
}

export function cacheAllHistoryDataInBackground() {
    if (backgroundFetchPromise) {
        return;
    }

    console.log("Starting quiet background fetch for all driver history...");
    
    backgroundFetchPromise = (async () => {
        try {
            const response = await fetch(UNIFIED_HISTORY_URL);
            if (!response.ok) throw new Error('Network response for unified history was not ok.');
            const result = await response.json();
            if (!result.success) throw new Error(`API Error: ${result.message}`);
            
            const allData = result.data;

            for (const driverName in allData.safety) {
                const normalizedName = normalizeDriverName(driverName);
                setCachedData(`safetyHistory_${normalizedName}`, allData.safety[driverName]);
            }
            for (const driverName in allData.hourly) {
                const normalizedName = normalizeDriverName(driverName);
                setCachedData(`fuelHistory_${normalizedName}`, allData.hourly[driverName]);
            }
            for (const driverName in allData.po) {
                const normalizedName = normalizeDriverName(driverName);
                setCachedData(`poHistory_${normalizedName}`, allData.po[driverName]);
            }
            for (const driverName in allData.fuelPurchases) {
                const normalizedName = normalizeDriverName(driverName);
                setCachedData(`fuelPurchaseHistory_${normalizedName}`, allData.fuelPurchases[driverName]);
            }
            for (const driverName in allData.changelog) {
                const normalizedName = normalizeDriverName(driverName);
                setCachedData(`changelogHistory_${normalizedName}`, allData.changelog[driverName]);
            }

            console.log("✅ Successfully populated the in-memory history cache.");
        } catch (error) {
            console.error("Failed to fetch and cache all history data:", error);
            backgroundFetchPromise = null;
            throw error;
        }
    })();
}


export async function loadDispatcherOverrides() {
    const cacheKey = 'dispatcherOverrides';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    try {
        const response = await fetch(DISPATCHER_OVERRIDES_URL);
        if (!response.ok) throw new Error('Network response for dispatcher overrides was not ok.');
        const result = await response.json();
        if (!result.success) throw new Error(`API Error: ${result.message}`);
        
        // Process data into a map for quick lookups: { "DriverName_YYYY-MM-DD": "STATUS" }
        const overrideMap = result.data.reduce((acc, row) => {
            const key = `${row['Driver Name']}_${row['Date']}`;
            acc[key] = row['Confirmed Status'];
            return acc;
        }, {});

        setCachedData(cacheKey, overrideMap);
        return overrideMap;
    } catch (error) {
        console.error("Failed to fetch dispatcher overrides:", error);
        return {};
    }
}

export async function loadFinancialData() {
    const cacheKey = 'financialData';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    try {
        const response = await fetch(FINANCIAL_DATA_URL);
        if (!response.ok) throw new Error('Network response for financial data was not ok.');
        const result = await response.json();
        setCachedData(cacheKey, result.data);
        return result.data;
    } catch (error) {
        console.error("Failed to fetch financial data:", error);
        return [];
    }
}
