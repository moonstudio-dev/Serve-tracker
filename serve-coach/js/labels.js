/*
 * labels.js — display names for the three separate per-clip settings.
 *   Serving side:     deuce | ad
 *   Tripod position:  behind | side | unknown   (physical place of the tripod)
 *   Phone camera:     environment (rear) | user (front)
 */
export const sideName = (s) => (s === 'ad' ? 'Ad' : s === 'deuce' ? 'Deuce' : '–');
export const tripodName = (p) => (p === 'behind' ? 'Behind' : p === 'side' ? 'Side' : 'Unknown');
export const camName = (c) => (c && c.facing === 'user' ? 'Front' : 'Rear');
export const orientationName = (o) => (o === 'portrait' ? 'Portrait' : o === 'landscape' ? 'Landscape' : 'Unknown');
