/**
 * feedback-api.js
 * * This script connects the public feedback.html page to Supabase.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// 1. Create a Supabase client just for this page
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Submits the feedback from the public survey to Supabase.
 * @param {object} feedbackData The complete feedback object
 * @returns {Promise<object>} The JSON response from the server
 */
export async function submitPublicFeedback(feedbackData) {
    
    // 2. Insert the data into the 'feedback' table you just created
    const { data, error } = await supabase
        .from('feedback')
        .insert(feedbackData)
        .select(); // .select() asks Supabase to return the new row

    if (error) {
        // 3. If it fails, throw an error
        console.error('Supabase error:', error);
        throw new Error(error.message);
    }
    
    // 4. If it succeeds, return the new data
    return { status: 'success', data: data[0] };
}