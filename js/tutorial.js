import { getDummyOverrides } from './dummyData.js';

const tutorialSteps = [
    {
        title: 'Welcome!',
        text: "Welcome to the Dispatcher Confirmation Portal! This tutorial will guide you through verifying a driver's activity using a safe, interactive example."
    },
    {
        element: '#dispatcher-pay-date-select',
        title: '1. Select the Pay Week',
        text: "First, start by choosing the pay period you want to review. For this tutorial, we've pre-selected the week for you."
    },
    {
        element: '#dispatcher-driver-search',
        title: '2. Find a Driver',
        text: "Now, find a driver. Type <strong>'Dummy Dispatcher'</strong> into the search box to see their drivers.",
        action: { type: 'input', value: 'dummy' }
    },
    {
        element: '#driver-list-container .driver-list-item',
        title: '3. Select the Dummy Driver',
        text: "Great! Now, click on <strong>'Dummy Driver'</strong> from the list to see their weekly activity.",
        action: { type: 'click' }
    },
    {
        element: '#activity-confirmation-area',
        title: '4. Review the Week',
        text: 'Here you can review the 7-day activity. Each card shows the system status and miles. Notice that one day has a different status.'
    },
    {
        element: '.day-card:last-child .status-select',
        title: '5. Make a Change',
        text: "Let's pretend Monday's status is wrong. Click the dropdown for Monday and change it to <strong>'DAY OFF'</strong>.",
        action: { type: 'change', value: 'DAY_OFF' }
    },
    {
        element: '#action-btn',
        title: '6. Confirm the Changes',
        text: "Perfect! The button now says 'Save Changes & Confirm'. Click it to lock in your changes for the week.",
        action: { type: 'clickThenWait' }
    },
    {
        element: '#save-footer',
        title: '7. The Verified State',
        text: "The week is now verified! If you made a mistake, you could click the 'Edit' button to unlock the week and make corrections."
    },
    {
        title: 'Important Final Step',
        text: 'Verifying each week is critical for accurate payroll. Even if no changes are needed, always click <strong>"Confirm as Correct"</strong> to lock in the week. This ensures every driver has been reviewed.'
    },
    {
        title: 'You\'re all set!',
        text: "That's the complete workflow. You can restart this tutorial anytime. Click 'Finish' to exit."
    }
];


let currentStep = 0;
let endTutorialCallback = null;
const tutorialOverlay = document.getElementById('tutorial-overlay');
const tutorialBox = document.getElementById('tutorial-box');

function positionTutorialBox(element) {
    if (!element) {
        tutorialBox.style.top = '50%';
        tutorialBox.style.left = '50%';
        tutorialBox.style.transform = 'translate(-50%, -50%)';
        return;
    }
    const rect = element.getBoundingClientRect();
    const boxRect = tutorialBox.getBoundingClientRect();
    let top = rect.top + rect.height / 2 - boxRect.height / 2;
    let left = rect.right + 20;
    if (left + boxRect.width > window.innerWidth) left = rect.left - boxRect.width - 20;
    if (top < 10) top = 10;
    if (top + boxRect.height > window.innerHeight) top = window.innerHeight - boxRect.height - 10;
    tutorialBox.style.top = `${top}px`;
    tutorialBox.style.left = `${left}px`;
    tutorialBox.style.transform = 'none';
}

function proceed() {
    if (currentStep < tutorialSteps.length - 1) {
        currentStep++;
        showStep(currentStep);
    } else {
        endTutorial();
    }
}

function showStep(index) {
    document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
    
    const step = tutorialSteps[index];
    const { element, title, text, action } = step;
    const nextButton = document.getElementById('tutorial-next');

    document.getElementById('tutorial-title').textContent = title;
    document.getElementById('tutorial-text').innerHTML = text;
    document.getElementById('tutorial-prev').disabled = index === 0;
    nextButton.textContent = (index === tutorialSteps.length - 1) ? 'Finish' : 'Next';

    const targetElement = element ? document.querySelector(element) : null;
    if (targetElement) {
        targetElement.classList.add('tutorial-highlight');
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
    
    nextButton.disabled = !!action;

    if (action) {
        const eventType = action.type === 'clickThenWait' ? 'click' : action.type;
        const listener = (e) => {
            let conditionMet = false;
            if (action.type === 'input' && e.target.value.toLowerCase().includes(action.value)) conditionMet = true;
            if (action.type === 'click' || action.type === 'clickThenWait') conditionMet = true;
            if (action.type === 'change' && e.target.value === action.value) conditionMet = true;

            if (conditionMet) {
                targetElement.removeEventListener(eventType, listener);

                if (action.type === 'clickThenWait') {
                    const checkVerification = () => {
                        const overrides = getDummyOverrides();
                        if (Object.keys(overrides).length >= 7) {
                            nextButton.disabled = false;
                        } else {
                            setTimeout(checkVerification, 300);
                        }
                    };
                    checkVerification();
                } else {
                    nextButton.disabled = false;
                }
            }
        };
        targetElement.addEventListener(eventType, listener);
    }

    positionTutorialBox(targetElement);
}

export function startTutorial(reloadCallback) {
    endTutorialCallback = reloadCallback;
    localStorage.setItem('dispatcherTutorialSeen', 'true');
    tutorialOverlay.classList.remove('hidden');
    tutorialBox.classList.remove('hidden');
    document.body.classList.add('tutorial-active');
    currentStep = 0;
    showStep(currentStep);
}

function endTutorial() {
    tutorialOverlay.classList.add('hidden');
    tutorialBox.classList.add('hidden');
    document.body.classList.remove('tutorial-active');
    document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
    
    if (endTutorialCallback) {
        endTutorialCallback();
    }
}

document.getElementById('tutorial-next').addEventListener('click', proceed);
document.getElementById('tutorial-prev').addEventListener('click', () => {
    if (currentStep > 0) {
        currentStep--;
        showStep(currentStep);
    }
});
document.getElementById('tutorial-end').addEventListener('click', endTutorial);