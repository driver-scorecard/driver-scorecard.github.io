/**
 * config.js
 * * Contains static configuration for the application, such as API endpoints
 * and the main data structure for table columns.
 */

// ⬇️ UPDATE THIS with your Cloudflare Worker URL ⬇️
const API_BASE_URL = "https://my-tpog-proxy.mihailo-cfc.workers.dev/api/";

// All application URLs now point to the secure proxy
export const EDITABLE_DATA_URL = API_BASE_URL + "EDITABLE_DATA_URL";
export const LOGIN_SCRIPT_URL = API_BASE_URL + "LOGIN_SCRIPT_URL";
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
export const DISPATCHER_OVERRIDES_URL = API_BASE_URL + "DISPATCHER_OVERRIDES_URL";
export const FINANCIAL_DATA_URL = API_BASE_URL + "FINANCIAL_DATA_URL";

export const WEEKLY_NOTES_URL = "https://script.google.com/macros/s/AKfycby0Z38HilNYbGJkRaIRg-Dkwrz2noD8Pap_kghIdBJ1Ss0i-_sYUWVTjll6iAcdDUpH/exec";
export const LOCKED_DATA_URL = "https://script.google.com/macros/s/AKfycbzsBXVtbIWbXFKIf8Z3RktL743qcm7-3drtfbKhVwmmM45EHTrd122JvMKX4da3LbPivg/exec";

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