/**
 * api.js
 * * Handles all network requests to fetch and save data from Google Apps Script endpoints,
 * * with a session-based in-memory caching layer to improve performance during a single session.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
    SETTINGS_SCRIPT_URL,
    LOGIN_SCRIPT_URL,
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
    FINANCIAL_DATA_URL,
    EDITABLE_DATA_URL,
    WEEKLY_NOTES_URL,
    LOCKED_DATA_URL,
    TERMINATED_DRIVERS_URL,
    ARCHIVED_DRIVER_DETAILS_URL,
    FETCH_ALL_ARCHIVE_URL,
    DRIVER_FEEDBACK_URL,
    SUPABASE_URL,
    SUPABASE_ANON_KEY
} from './config.js';

// --- ADD THIS LINE RIGHT AFTER THE IMPORTS ---
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- NEW HELPER FUNCTION ---
/**
 * Fetches a resource with automatic retries on failure.
 * @param {string} url The URL to fetch.
 * @param {number} [retries=3] The total number of attempts to make.
 * @returns {Promise<any>} The parsed JSON result.
 */
async function fetchWithRetry(url, resourceName, retries = 3) {
    let lastError;

    for (let i = 0; i < retries; i++) {
        try {
            // Log the attempt
            console.log(`[Fetch] Attempt ${i + 1}/${retries} for ${resourceName}...`);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                // If the server response is bad (e.g., 404, 500), throw an error
                throw new Error(`Network response was not ok (${response.status})`);
            }
            
            const result = await response.json();
            
            // Check for Google Apps Script-level errors (if it returns a JSON with success: false)
            if (result.status === 'error' || result.success === false) {
                throw new Error(result.message || 'API returned a failure status');
            }
            
            // If we get here, the fetch was a success
            return result; 

        } catch (error) {
            // Log the error for this attempt
            lastError = error;
            console.warn(`[Fetch] Attempt ${i + 1} for ${resourceName} failed: ${error.message}`);
            
            // If this wasn't the last retry, wait before trying again
            if (i < retries - 1) {
                // Wait for 1 second, then 2 seconds, etc.
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    }
    
    // If the loop finishes, all retries have failed.
    console.error(`[Fetch] All ${retries} attempts failed for ${resourceName}.`);
    // Throw the last error that was caught
    throw lastError;
}

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

    // fetchWithRetry will try 3 times before failing
    const settings = await fetchWithRetry(SETTINGS_SCRIPT_URL, "Settings"); 
    
    setCachedData(cacheKey, settings);
    return settings;
}

export async function loadMileageData() {
    const cacheKey = 'mileageData';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    // fetchWithRetry will try 3 times before failing
    const result = await fetchWithRetry(MILEAGE_DATA_URL, "Mileage Data"); 
    
    setCachedData(cacheKey, result.data);
    return result.data;
}

export async function fetchDriverData() {
    const cacheKey = 'driverData';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    // fetchWithRetry will try 3 times before failing
    const result = await fetchWithRetry(DRIVER_DATA_URL, "Driver Data"); 

    const formattedData = result.data.map(d => ({
        id: d.contract_id, name: d.driver_name, driver_rep: d.driver_rep || '-', dispatcher: d.dispatch || '-', team: d.team || '-',
        franchise: d.franchise || '-', company: d.company || '-', contract_type: d.contract_type || '-',
        weeksOut: 0, milesWeek: d.milesWeek || 0, tenure: d.tenure || 0, gross: d.gross || 0, stubMiles: 0, rpm: d.rpm || 0,
        estimatedNet: d.estimated_net || 0, safetyScore: d.safety_score || 0, speedingAlerts: d.speed_events || 0,
        speeding_over11mph: d.speeding_over11mph || 0, speeding_over16mph: d.speeding_over16mph || 0,
        stubMpg: d.fuel_stubs || 0,
        mpg: parseFloat(d.gallons_fictive > 0 ? (d.distance / d.gallons_fictive) : 0).toFixed(1),
        pay_date: d.pay_date, bonuses: 0, penalties: 0,
        distance: d.distance || 0,
        gallons_fictive: d.gallons_fictive || 0,
        pay_delayWks: d.pay_delayWks || 1
    }));
    setCachedData(cacheKey, formattedData);
    return formattedData;
}

export async function saveSettings(settings) {
    try {
        const response = await fetch(SETTINGS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            throw new Error(`Network response was not ok, status: ${response.status}`);
        }

        const result = await response.json();
        if (result.status !== 'success') {
            throw new Error(result.message);
        }
        sessionCache['settings'] = null;

    } catch (error) {
        console.error("Failed to save settings:", error);
        alert(`ERROR: Could not save the new settings. Reason: ${error.message}`);
    }
}


export async function fetchSafetyHistory(driverName) {
    const normalizedName = normalizeDriverName(driverName);
    const cacheKey = `safetyHistory_${normalizedName}`;
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
        return Promise.resolve(cachedData);
    }

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

    const result = await fetchWithRetry(ALL_SAFETY_DATA_URL, "All Safety Data");
    
    setCachedData(cacheKey, result.data);
    return result.data;
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

    const result = await fetchWithRetry(DAYS_TAKEN_HISTORY_URL, "Days Taken History");

    setCachedData(cacheKey, result.data);
    return result.data;
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

    const result = await fetchWithRetry(DISTANCE_OVERRIDE_URL, "Distance Overrides");

    setCachedData(cacheKey, result.data);
    return result.data;
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

            // --- START MODIFICATION ---
            // Store the entire objects for global analysis
            setCachedData('fuelHistory_UNIFIED', allData.hourly);
            setCachedData('fuelPurchaseHistory_UNIFIED', allData.fuelPurchases);
            // --- END MODIFICATION ---

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

    // FIX: Added .limit(10000) to fetch up to 10,000 rows instead of the default 1,000
    const { data, error } = await supabase
        .from('dispatcher_overrides')
        .select('*')
        .limit(10000);

    if (error) {
        console.error("Failed to load dispatcher overrides:", error);
        return {};
    }

    // Transform into the Map expected by the app: { "DriverName_Date": "Status" }
    const overrideMap = {};
    data.forEach(row => {
        const key = `${row.driver_name}_${row.date}`;
        overrideMap[key] = row.status;
    });

    setCachedData(cacheKey, overrideMap);
    return overrideMap;
}

// --- NEW FUNCTION ---
export async function saveDispatcherOverrides(overrides) {
    // Invalidate cache
    sessionCache['dispatcherOverrides'] = null;

    // Format for Supabase
    const records = overrides.map(ov => ({
        driver_name: ov.driverName,
        date: ov.date,
        status: ov.status,
        updated_at: new Date().toISOString()
    }));

    const { error } = await supabase
        .from('dispatcher_overrides')
        .upsert(records, { onConflict: 'driver_name, date' });

    if (error) {
        console.error("Failed to save dispatcher overrides:", error);
        throw new Error(error.message);
    }
    return { status: 'success' };
}

export async function loadWeeklyNotes() {
    const cacheKey = 'weeklyNotes';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    // FIX: Added .limit(10000) to fetch up to 10,000 rows instead of the default 1,000
    const { data, error } = await supabase
        .from('weekly_notes')
        .select('*')
        .limit(10000);

    if (error) {
        console.error("Failed to load weekly notes:", error);
        return {};
    }

    // Transform into the Map expected by the app: { "DriverName_Date": "Note" }
    const notesMap = {};
    data.forEach(row => {
        const key = `${row.driver_name}_${row.pay_date}`;
        notesMap[key] = row.note;
    });
    
    setCachedData(cacheKey, notesMap);
    return notesMap;
}

export async function saveWeeklyNote(driverName, payDate, note) {
    // Invalidate cache
    sessionCache['weeklyNotes'] = null;

    if (!note || note.trim() === '') {
        // If note is empty, delete it
        const { error } = await supabase
            .from('weekly_notes')
            .delete()
            .eq('driver_name', driverName)
            .eq('pay_date', payDate);
            
        if (error) {
             console.error("Failed to delete weekly note:", error);
             return { status: 'error', message: error.message };
        }
        return { status: 'success' };
    } else {
        // Upsert (Insert or Update)
        const { data, error } = await supabase
            .from('weekly_notes')
            .upsert({ 
                driver_name: driverName, 
                pay_date: payDate, 
                note: note,
                updated_at: new Date().toISOString()
            }, { onConflict: 'driver_name, pay_date' });

        if (error) {
            console.error("Failed to save weekly note:", error);
            return { status: 'error', message: error.message };
        }
        return { status: 'success', data };
    }
}

export async function loadFinancialData() {
    const cacheKey = 'financialData';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    const result = await fetchWithRetry(FINANCIAL_DATA_URL, "Financial Data");
    
    setCachedData(cacheKey, result.data);
    return result.data;
}

export async function loginUser(email, password) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .eq('password', password) // Note: Simple comparison for now
            .single();

        if (error || !data) {
            throw new Error('Invalid email or password.');
        }

        // Create a fake "token" since we aren't using Supabase Auth yet
        const token = btoa(`${email}:${Date.now()}`); 
        
        return { status: 'success', user: data, token: token };
    } catch (error) {
        console.error("Failed to login:", error);
        return { status: 'error', message: error.message };
    }
}

export async function fetchAllUsers() {
    try {
        const { data, error } = await supabase.from('users').select('*');
        if (error) throw error;
        return { status: 'success', users: data };
    } catch (error) {
        console.error("Failed to fetch users:", error);
        return { status: 'error', message: 'Failed to fetch users.' };
    }
}

export async function addUser(userData) {
    try {
        const { error } = await supabase.from('users').insert(userData);
        if (error) throw error;
        return { status: 'success' };
    } catch (error) {
        console.error("Failed to add user:", error);
        return { status: 'error', message: error.message };
    }
}

export async function deleteUser(email) {
    try {
        const { error } = await supabase.from('users').delete().eq('email', email);
        if (error) throw error;
        return { status: 'success' };
    } catch (error) {
        console.error("Failed to delete user:", error);
        return { status: 'error', message: error.message };
    }
}

export async function editUser(userData) {
    try {
        const { originalEmail, ...updates } = userData;
        // If email is changing, we need to handle that, but standard edit usually uses ID/Email key
        // Since email is PK, we update based on originalEmail if provided, else email
        const targetEmail = originalEmail || updates.email;
        
        const { error } = await supabase
            .from('users')
            .update(updates)
            .eq('email', targetEmail);

        if (error) throw error;
        return { status: 'success' };
    } catch (error) {
        console.error("Failed to edit user:", error);
        return { status: 'error', message: error.message };
    }
}

export async function saveEditableData(driverId, payDate, updates) {
    try {
        await fetch(EDITABLE_DATA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            // The 'updates' parameter is now an array of changes
            body: JSON.stringify({ action: 'save', driverId, payDate, updates: updates }),
            mode: 'no-cors'
        });
    } catch (error) {
        console.warn("CORS error is expected for save. Assuming success.");
    }
}

export async function revertToDefault(driverId, payDate) {
    const response = await fetch(EDITABLE_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'delete', driverId, payDate })
    });

    if (!response.ok) {
       throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    if (result.status !== 'success') {
        throw new Error(result.message);
    }
    
    // main.js handles updating its own 'savedOverrides' variable.
    return result;
}

export async function loadOverrides() {
    const cacheKey = 'editableOverrides';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    const result = await fetchWithRetry(EDITABLE_DATA_URL, "Saved Overrides");
    
    console.log(`Successfully fetched ${result.data.length} override(s).`);
    setCachedData(cacheKey, result.data);
    return result.data;
}


export async function loadLockedData() {
    const cacheKey = 'lockedData';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    // Fetch directly from Supabase
    const { data, error } = await supabase
        .from('locked_data')
        .select('*');

    if (error) {
        console.error("Failed to load locked data from Supabase:", error);
        throw new Error(error.message);
    }

    // Transform array into the Map expected by the app: { "DriverID_Date": "JSONString" }
    const lockedMap = {};
    data.forEach(row => {
        const key = `${row.driver_id}_${row.pay_date}`;
        lockedMap[key] = row.locked_data;
    });
    
    setCachedData(cacheKey, lockedMap);
    return lockedMap;
}

export async function updateLockedData(driverId, driverName, payDate, action, lockedDataJSON = null) {
    // Invalidate cache immediately
    sessionCache['lockedData'] = null;

    if (action === 'lock') {
        // UPSERT: Insert or Update if it exists
        // We assume the table has a unique constraint on (driver_id, pay_date)
        const { data, error } = await supabase
            .from('locked_data')
            .upsert({ 
                driver_id: driverId, 
                pay_date: payDate, 
                driver_name: driverName, 
                locked_data: lockedDataJSON 
            }, { onConflict: 'driver_id, pay_date' })
            .select();

        if (error) throw new Error(error.message);
        return { status: 'success', data };

    } else if (action === 'unlock') {
        // DELETE
        const { error } = await supabase
            .from('locked_data')
            .delete()
            .eq('driver_id', driverId)
            .eq('pay_date', payDate);

        if (error) throw new Error(error.message);
        return { status: 'success' };
    }
}

// --- NEW ARCHIVE FUNCTIONS ---

/**
 * Fetches the summary list of all terminated drivers.
 */
export async function fetchTerminatedDrivers() {
    try {
        const response = await fetch(TERMINATED_DRIVERS_URL);
        if (!response.ok) throw new Error('Network response for terminated drivers was not ok.');
        const result = await response.json();
        if (result.status !== 'success') throw new Error(result.message);
        return result; // Returns { status: "success", data: [...] }
    } catch (error) {
        console.error("Failed to fetch terminated drivers:", error);
        return { status: "error", message: error.message, data: [] };
    }
}

/**
 * Fetches all detailed historical data for a single archived driver.
 */
export async function fetchArchivedDriverDetails(driverId) {
    try {
        const url = new URL(ARCHIVED_DRIVER_DETAILS_URL);
        url.searchParams.append('driverId', driverId); // Pass driverName as driverId
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response for archived driver details was not ok.');
        
        const result = await response.json();
        if (result.status !== 'success') throw new Error(result.message);
        
        return result; // Returns { status: "success", data: { profile: ..., financials: ... } }
    } catch (error) {
        console.error("Failed to fetch archived driver details:", error);
        return { status: "error", message: error.message };
    }
}

/**
 * Fetches all terminated drivers and all their details in one single request.
 * WARNING: This may time out or fail if the dataset is too large.
 */
export async function fetchAllArchiveData() {
    try {
        // This uses the new config variable that points to the correct proxy URL and action
        const response = await fetch(FETCH_ALL_ARCHIVE_URL); 
        if (!response.ok) throw new Error('Network response for all archive data was not ok.');

        const result = await response.json();
        if (result.status !== 'success') throw new Error(result.message);

        return result; // Returns { status: "success", data: [ ...all driver objects... ] }
    } catch (error) {
        console.error("Failed to fetch all archive data:", error);
        return { status: "error", message: error.message, data: [] };
    }
}

/**
 * Submits internal admin/onboarder feedback (like status changes) to Supabase.
 * This is called from main.js, not the public feedback form.
 * @param {string} driverId The ID of the driver.
 * @param {object} feedbackData The partial feedback object from main.js.
 * @param {object} currentUser The user object of the person making the change.
 * @returns {Promise<object>} The JSON response from the server.
 */
export async function submitDriverFeedback(driverId, feedbackData, currentUser) {
    try {
        // 1. Translate the status from "Rehireable" / "Do Not Rehire" to "Yes" / "No"
        const rehireValue = feedbackData.status === 'Rehireable' ? 'Yes' : (feedbackData.status === 'Do Not Rehire' ? 'No' : null);

        // 2. Build the payload for the 'feedback' table
        const payload = {
            driver_id: driverId,
            author_role: currentUser ? currentUser.role : 'Admin',
            note: feedbackData.note,
            rehire: rehireValue,
            // Set other survey fields to null as this is just a status update
            coachable: null,
            hustle: null,
            communication: null,
            overall_score: null, 
            terms: null 
        };

        // 3. Use the existing 'supabase' client from this file
        const { data, error } = await supabase
            .from('feedback')
            .insert(payload)
            .select(); // Ask Supabase to return the newly created row

        if (error) {
            console.error('Supabase error (submitDriverFeedback):', error);
            throw new Error(error.message);
        }

        // 4. Return the new data in the expected format
        return { status: 'success', data: data[0] };

    } catch (error) {
        console.error("Failed to submit driver feedback:", error);
        return { status: "error", message: error.message };
    }
}


/**
 * Gets the cached hourly fuel/telematics data.
 * @returns {Object|null} The cached data or null.
 */
export function getCachedFuelHistory() {
    return getCachedData('fuelHistory_UNIFIED');
}

/**
 * Gets the cached fuel purchase data.
 * @returns {Object|null} The cached data or null.
 */
export function getCachedPurchaseHistory() {
    return getCachedData('fuelPurchaseHistory_UNIFIED');
}

export async function loadMpgOverrides() {
    const cacheKey = 'mpgOverrides';
    const cachedData = getCachedData(cacheKey);
    if (cachedData) return Promise.resolve(cachedData);

    const { data, error } = await supabase
        .from('mpg_overrides')
        .select('*')
        .limit(10000);

    if (error) {
        console.error("Failed to load MPG overrides:", error);
        return {};
    }

    const overrideMap = {};
    data.forEach(row => {
        const key = `${row.driver_id}_${row.pay_date}`;
        overrideMap[key] = row.source;
    });

    setCachedData(cacheKey, overrideMap);
    return overrideMap;
}

export async function saveMpgOverride(driverId, source, payDate) {
    sessionCache['mpgOverrides'] = null; // Invalidate cache

    const { error } = await supabase
        .from('mpg_overrides')
        .upsert({ 
            driver_id: driverId, 
            pay_date: payDate, 
            source: source,
            updated_at: new Date().toISOString()
        }, { onConflict: 'driver_id, pay_date' });

    if (error) {
        console.error("Failed to save MPG override:", error);
        throw new Error(error.message);
    }
    return { status: 'success' };
}