/**
 * utils.js - Utility functions for the AI Agent Dashboard
 */

/**
 * Generates a unique ID that works across all browsers
 * Uses crypto.randomUUID() when available, falls back to timestamp + random string
 * @returns {string} A unique identifier string
 */
export const generateId = () => {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  
  // Fallback implementation for older browsers or environments without crypto.randomUUID
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomStr}`;
};

/**
 * Format a timestamp to a readable date/time string
 * @param {number} timestamp - Timestamp in milliseconds
 * @returns {string} Formatted date string
 */
export const formatTimestamp = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * Truncate long text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length before truncation
 * @returns {string} Truncated text
 */
export const truncateText = (text, maxLength = 100) => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};
