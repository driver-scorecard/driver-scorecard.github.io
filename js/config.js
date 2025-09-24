/**
 * config.js
 * * Contains static configuration for the application, such as API endpoints
 * and the main data structure for table columns.
 */


// Loads and saves the calculation rules (bonuses, penalties) from the settings panel.
export const SETTINGS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyuMDzzO0E6Re4yrEoLfaVUMmPu_gmRY0e6ojczLUjAP__mkuwQKE24IjYZj4Ek9RZV/exec";

// Fetches the main list of drivers and their performance data for the selected pay date.
export const DRIVER_DATA_URL = "https://script.google.com/macros/s/AKfycbzbqDrwVEHFxYKYYBxju4zNoVQUaKas90Al7-oEy2Rd3TMzA28C_HIoRqRE8soJ-AlSNw/exec";

// Retrieves all historical mileage records, used to calculate "Weeks Out".
export const MILEAGE_DATA_URL = "https://script.google.com/macros/s/AKfycbyQJbNmu39EQpmOh7ho_cHk2oxxc7GcDw0Jf5wldsxVQcr7KiTshlwlcbctKkVDqXpeuQ/exec";

// Fetches a single driver's detailed hourly fuel level and odometer history for the MPG chart.
export const FUEL_HISTORY_URL = "https://script.google.com/macros/s/AKfycbxnfhEBxySnPkFZc29u0WmOfsB-ZORV7N0skbnciLiaYmkjVwf2hrINz5l4_Sx6T9lg/exec";

// Fetches a single driver's weekly safety scores and event history for the Safety chart.
export const SAFETY_HISTORY_URL = "https://script.google.com/macros/s/AKfycbwsrQNsEVzAzEBzM5SlznE_5w2UNAp612uS9mtbeuA3dSvcEwSeRzVhDSj3i0Nhf_uG/exec";

// Fetches a single driver's Purchase Order (PO) history for the Fuel PO tab.
export const PO_HISTORY_URL = "https://script.google.com/macros/s/AKfycbwimmryw_pbcJ0bKl62xFoZwURqztZEUh0qQoxtbwLiwbhP8BZRPGQOQUPFllDt1FpY/exec";

// Retrieves a single driver's fuel purchase records to merge with MPG data.
export const FUEL_PURCHASE_HISTORY_URL = "https://script.google.com/macros/s/AKfycbzuvr_lnPNp65yPT1ARsHSnY4Lp2w6f9mWE_VH-Ghm37WOhPWmbY6iJ80kUePTCixE5eQ/exec";

// Fetches the changelog/activity status history (DAY_OFF, ACTIVE, etc.).
export const DAYS_TAKEN_HISTORY_URL = "https://script.google.com/macros/s/AKfycbxwpA113gZMmGCYQQdl9u3FiShY-LFfcOJY_Nj4mFg1kmzzan0MgUUXfmsiyU1lg0_G/exec";

// Gets the status change history for a single driver, shown in the Changelog tab.
export const CHANGELOG_URL = "https://script.google.com/macros/s/AKfycbyc_ZPmCqSjHlrKgQScbSJwhavxcuXN04QTRW2_1PolPQIQcsmnzJO_AlzkGZak3DA-/exec";

// Loads all safety data for all drivers at once, used for calculating percentiles.
export const ALL_SAFETY_DATA_URL = "https://script.google.com/macros/s/AKfycby3fd3J9bEsflBjN_zhFDIEWpC6kW1vTsYkGd4z5WfqkHBG9En7IN_ukfrqIQmv-V7Oyw/exec";

// Loads and saves which drivers should use Samsara distance instead of ProLogs.
export const DISTANCE_OVERRIDE_URL = "https://script.google.com/macros/s/AKfycby4j96cj4YZutdiceKjjo9PgDf3FVzsDZSM96Bi2ynu1y6YHYhETQYxaPgcdRuUSwRv/exec";

// Fetches all historical data (Safety, MPG, PO, etc.) for all drivers in a single call to cache in the background.
export const UNIFIED_HISTORY_URL = "https://script.google.com/macros/s/AKfycbz_zZgWGn6mdydu87AhSEdM7-_DoPWJ4vHgTsMY1qCETQmwbJcKjeMxwxuFPosb4TzS/exec";

// Loads the dispatcher-confirmed activity status overrides.
export const DISPATCHER_OVERRIDES_URL = "https://script.google.com/macros/s/AKfycbx7Jjy0TVuU6Hmm9VlYRY83cjptK7U6i42lv2Uhc9SdbSTzEpHcsAKT_L8XV2BzGs4F8A/exec";


export const columnConfig = {
    name: { title: 'Driver Name', type: 'text', class: 'text-left font-medium text-slate-100' },
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
    rpm: { title: 'RPM', type: 'number', class: 'text-center' },
    estimatedNet: { title: 'Estimated Net', type: 'number', class: 'text-center' },
    totalTpog: { title: 'Final %', type: 'calc', class: 'text-center whitespace-nowrap' },
    bonuses: { title: 'Bonuses', type: 'calc', class: 'text-center font-semibold' },
    penalties: { title: 'Penalties', type: 'calc', class: 'text-center font-semibold' },
    actions: { title: 'Actions', type: 'action', class: 'text-center' }
};
