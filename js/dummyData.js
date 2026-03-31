// TPOG/js/dummyData.js

// Generates a consistent set of dummy data for the tutorial
export function generateDummyData() {
    const dummyDriverName = "Dummy Driver";
    const dummyDispatcher = "Dummy Dispatcher";

    // --- Dummy Driver and Pay Date Info ---
    const allDriverData = {
        [dummyDriverName]: {
            name: dummyDriverName,
            dispatcher: dummyDispatcher,
            activity: {}
        }
    };

    const allPayDates = ["2025-09-25"]; // A fixed date for the tutorial
    const payDate = new Date("2025-09-25T12:00:00Z");

    // --- Generate Activity for the Dummy Week ---
    const dayOfWeek = payDate.getUTCDay();
    const daysToSubtract = (dayOfWeek + 6) % 7;
    const monday = new Date(payDate);
    monday.setUTCDate(payDate.getUTCDate() - daysToSubtract);
    const tuesday = new Date(monday);
    tuesday.setUTCDate(monday.getUTCDate() - 6);

    const statuses = ["NO DATA", "NO DATA", "NO DATA", "ACTIVE", "ACTIVE", "WITHOUT LOAD", "ACTIVE"];
    const miles = [0, 1, 73, 750, 641, 545, 442];

    for (let i = 0; i < 7; i++) {
        const currentDay = new Date(tuesday);
        currentDay.setUTCDate(tuesday.getUTCDate() + i);
        const dayString = currentDay.toISOString().split('T')[0];
        
        allDriverData[dummyDriverName].activity[dayString] = {
            date: dayString,
            prologMiles: miles[i],
            systemStatus: statuses[i]
        };
    }

    return { allDriverData, allPayDates };
}

// --- LocalStorage Interaction ---
const DUMMY_OVERRIDES_KEY = 'tutorial_overrides';

export function getDummyOverrides() {
    const stored = localStorage.getItem(DUMMY_OVERRIDES_KEY);
    return stored ? JSON.parse(stored) : {};
}

export function saveDummyOverrides(overridesToSave) {
    const currentOverrides = getDummyOverrides();
    overridesToSave.forEach(ov => {
        const key = `${ov.driverName}_${ov.date}`;
        currentOverrides[key] = ov.status;
    });
    localStorage.setItem(DUMMY_OVERRIDES_KEY, JSON.stringify(currentOverrides));
}

// Clear storage when the tutorial is not active
export function clearDummyStorage() {
    localStorage.removeItem(DUMMY_OVERRIDES_KEY);
}