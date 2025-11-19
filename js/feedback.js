/**
 * feedback.js
 * * This script powers the public feedback.html survey page.
 * * It reads URL parameters, validates them, and submits the form.
 */
import { submitPublicFeedback } from './feedback-api.js';

// --- DOM ELEMENTS ---
const driverNameEl = document.getElementById('feedback-driver-name');
const submitBtn = document.getElementById('submit-feedback-btn');
const errorMsg = document.getElementById('feedback-error-msg');
const formContainer = document.getElementById('feedback-form-container');
const successContainer = document.getElementById('feedback-success-container');
const modal = document.getElementById('custom-modal');

// --- FORM FIELDS ---
const noteInput = document.getElementById('feedback-note-textarea');

// --- URL PARAMETERS ---
let driverId, role, token, driverName;

/**
 * Gets the selected value from a radio button group.
 * @param {string} groupName The 'name' attribute of the radio group.
 * @returns {string} The value of the checked radio button.
 */
function getRadioValue(groupName) {
    const selected = document.querySelector(`input[name="${groupName}"]:checked`);
    return selected ? selected.value : null;
}

/**
 * Adds event listeners to star ratings to update the text display.
 * @param {string} groupName The 'name' attribute of the star radio group.
 * @param {HTMLElement} textElement The <span> element to update.
 */
function setupStarListeners(groupName, textElement) {
    const starInputs = document.querySelectorAll(`input[name="${groupName}"]`);
    starInputs.forEach(input => {
        // Use 'change' event as it's more reliable for radio buttons
        input.addEventListener('change', () => {
            // Find the *newly checked* input in this group
            const selectedValue = document.querySelector(`input[name="${groupName}"]:checked`).value;
            textElement.textContent = `${selectedValue}/10`;
        });
    });
}

/**
 * Handles the form submission
 */
async function handleSubmit() {
    // 1. Get values
    const coachable = parseInt(getRadioValue('coachable'), 10);
    const hustle = parseInt(getRadioValue('hustle'), 10);
    const communication = parseInt(getRadioValue('communication'), 10);
    const terms = getRadioValue('terms');
    const rehire = getRadioValue('rehire');

    // 2. Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    errorMsg.classList.add('hidden');

    // 3. Construct the feedback object to match our Supabase table
    const feedbackData = {
        driver_id: driverId,         // From the URL
        author_role: role,           // From the URL
        note: noteInput.value,
        coachable: coachable,
        hustle: hustle,
        communication: communication,
        overall_score: Math.round((coachable + hustle + communication) / 3 * 10) / 10, // Use 'overall_score'
        terms: terms,
        rehire: rehire,
    };

    try {
        // 4. Send the new object to our Supabase API
        // We no longer need the 'token'
        const result = await submitPublicFeedback(feedbackData);
        
        if (result.status === 'success') {
            // 5. Show success message
            formContainer.classList.add('hidden');
            successContainer.classList.remove('hidden');
        } else {
            // 6. Show error message
            throw new Error(result.message || 'An unknown error occurred.');
        }

    } catch (error) {
        console.error("Failed to submit feedback:", error);
        errorMsg.textContent = `Error: ${error.message}`;
        errorMsg.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Feedback';
    }
}

/**
 * Runs on page load to initialize the survey.
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Get parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    driverId = urlParams.get('driverId');
    driverName = urlParams.get('driverName');
    role = urlParams.get('role');
    token = urlParams.get('token'); // We'll send this for validation

    // 2. Validate URL
    if (!driverId || !driverName || !role || !token) {
        modal.innerHTML = `
            <div class="custom-modal-body text-center p-8">
                <h3 class="text-2xl font-bold text-red-500">Invalid Link</h3>
                <p class="text-sm text-slate-300 mt-2">
                    This feedback link is incomplete or has expired. Please request a new link.
                </p>
            </div>
        `;
        return;
    }

    // 3. Populate driver name
    driverNameEl.textContent = decodeURIComponent(driverName);

    // 4. Add listener to submit button
    submitBtn.addEventListener('click', handleSubmit);
    
    // 5. Set up star rating listeners
    setupStarListeners('coachable', document.getElementById('coachable-value'));
    setupStarListeners('hustle', document.getElementById('hustle-value'));
    setupStarListeners('communication', document.getElementById('comm-value'));
});