/**
 * config.js
 * * Contains static configuration for the application, such as API endpoints
 * and the main data structure for table columns.
 */

// ⬇️ Cloudflare Worker URL ⬇️
const API_BASE_URL = "https://my-tpog-proxy.mihailo-cfc.workers.dev/api/";

// All application URLs now point to the secure proxy
export const EDITABLE_DATA_URL = API_BASE_URL + "EDITABLE_DATA_URL";
export const LOGIN_SCRIPT_URL = API_BASE_URL + "LOGIN_SCRIPT_URL"; /// THIS ONE NOT BEING USED NOW SINCE IT'S IN SUPABASE ///
export const SETTINGS_SCRIPT_URL = API_BASE_URL + "SETTINGS_SCRIPT_URL";
export const DRIVER_DATA_URL = API_BASE_URL + "DRIVER_DATA_URL";
export const MILEAGE_DATA_URL = API_BASE_URL + "MILEAGE_DATA_URL";
export const FUEL_HISTORY_URL = API_BASE_URL + "FUEL_HISTORY_URL";
export const SAFETY_HISTORY_URL = API_BASE_URL + "SAFETY_HISTORY_URL";
export const PO_HISTORY_URL = API_BASE_URL + "PO_HISTORY_URL";
export const FUEL_PURCHASE_HISTORY_URL = API_BASE_URL + "FUEL_PURCHASE_HISTORY_URL";
export const DAYS_TAKEN_HISTORY_URL = API_BASE_URL + "DAYS_TAKEN_HISTORY_URL";
export const CHANGELOG_URL = API_BASE_URL + "CHANGELOG_URL";
export const ALL_SAFETY_DATA_URL = API_BASE_URL + "ALL_SAFETY_DATA_URL";
export const DISTANCE_OVERRIDE_URL = API_BASE_URL + "DISTANCE_OVERRIDE_URL";
export const UNIFIED_HISTORY_URL = API_BASE_URL + "UNIFIED_HISTORY_URL";
export const DISPATCHER_OVERRIDES_URL = API_BASE_URL + "DISPATCHER_OVERRIDES_URL"; /// THIS ONE NOT BEING USED NOW SINCE IT'S IN SUPABASE ///
export const FINANCIAL_DATA_URL = API_BASE_URL + "FINANCIAL_DATA_URL";
export const WEEKLY_NOTES_URL = API_BASE_URL + "WEEKLY_NOTES_URL"; /// THIS ONE NOT BEING USED NOW SINCE IT'S IN SUPABASE ///
export const LOCKED_DATA_URL = API_BASE_URL + "LOCKED_DATA_URL";  /// THIS ONE NOT BEING USED NOW SINCE IT'S IN SUPABASE ///

// ⬇️ This is the name of proxy variable ⬇️
export const ARCHIVE_DATA_URL = API_BASE_URL + "ARCHIVE_DATA_URL"; 

// This URL is for the "all-at-once" load.
export const FETCH_ALL_ARCHIVE_URL = ARCHIVE_DATA_URL + "?action=fetchAllArchiveData";

// This URL is kept to prevent your existing api.js file from breaking.
export const ARCHIVED_DRIVER_DETAILS_URL = ARCHIVE_DATA_URL + "?action=fetchArchivedDriverDetails";

// This URL is for the old "Terminated Drivers" list (also kept to prevent errors).
export const TERMINATED_DRIVERS_URL = ARCHIVE_DATA_URL + "?action=fetchTerminatedDrivers";

// This points to the same script for feedback.
export const DRIVER_FEEDBACK_URL = ARCHIVE_DATA_URL;


export const PUBLIC_FEEDBACK_SUBMIT_URL = ARCHIVE_DATA_URL;

// --- ADD THESE TWO LINES AT THE END ---
export const SUPABASE_URL = 'https://twavsoynmqrcxdgykpcd.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3YXZzb3lubXFyY3hkZ3lrcGNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTY4NzcsImV4cCI6MjA3NzkzMjg3N30.lVvYrf2-GHSzrs7-J8GvX3k5fvseaWj4Sep2wvR1-Us';

export const columnConfig = {
    name: { title: 'Driver Name', type: 'text', class: 'text-left font-medium text-slate-100' },
    driver_rep: { title: 'Driver Rep', type: 'text', class: 'text-center' },
    dispatcher: { title: 'Dispatcher', type: 'text', class: 'text-center' },
    team: { title: 'Team', type: 'text', class: 'text-center' },
    franchise: { title: 'Franchise', type: 'text', class: 'text-center' },
    company: { title: 'Company', type: 'text', class: 'text-center' },
    contract_type: { title: 'Contract Type', type: 'text', class: 'text-center' },
    pay_delayWks: { title: 'Pay Delay', type: 'number', class: 'text-center' },
    safetyScore: { title: 'Safety Score', type: 'percent', class: 'text-center' },
    speedingAlerts: { title: 'Speeding Alerts', type: 'number', class: 'text-center' },
    speeding_over11mph: { title: 'Speeding (11mph>)', type: 'number', class: 'text-center' },
    speeding_over16mph: { title: 'Speeding (16mph>)', type: 'number', class: 'text-center' },
    speedingPercentile: { title: 'Speeding %', type: 'percent', class: 'text-center' },
    weeklyActivity: { title: 'Weekly Activity', type: 'custom', class: 'text-center' },
    weeksOut: { title: 'Weeks Out', type: 'number', class: 'text-center' },
    availableOffDays: { title: 'Available Days Off', type: 'calc', class: 'text-center' },
    offDays: { title: 'Days Taken', type: 'number', class: 'text-center' },
    escrowDeduct: { title: 'Escrow Deduct', type: 'calc', class: 'text-center' },
    milesWeek: { title: 'Distance Prologs', type: 'number', class: 'text-center' },
    samsaraDistance: { title: 'Distance Samsara', type: 'number', class: 'text-center' },
    stubMpg: { title: 'Stub MPG (2w)', type: 'number', class: 'text-center' },
    mpg: { title: 'MPG', type: 'number', class: 'text-center' },
    mpgPercentile: { title: 'MPG %', type: 'percent', class: 'text-center' },
    tenure: { title: 'Tenure (Wks)', type: 'number', class: 'text-center' },
    gross: { title: 'Gross', type: 'number', class: 'text-center' },
    stubMiles: { title: 'Stub Miles', type: 'number', class: 'text-center' },
    rpm: { title: 'RPM', type: 'number', class: 'text-center' },
    estimatedNet: { title: 'Gross %', type: 'number', class: 'text-center' },
    totalTpog: { title: 'Final %', type: 'calc', class: 'text-center whitespace-nowrap' },
    bonuses: { title: 'Bonuses', type: 'calc', class: 'text-center font-semibold' },
    penalties: { title: 'Penalties', type: 'calc', class: 'text-center font-semibold' },
    actions: { title: 'Actions', type: 'action', class: 'text-center' }
};