/**
 * OctoMedia Color Palette System
 * Modern dark-themed design matching mobile app
 * 
 * Usage:
 *   import { ColorPalette, ThemeManager } from './colorPalette.js';
 *   ThemeManager.setTheme('dark');
 *   element.style.backgroundColor = ColorPalette.primary();
 */

const ColorPalette = {
    // ========================================
    // PRIMARY PALETTE - Foundation Colors
    // ========================================
    deepNavy: '#001524',
    techBlue: '#083D77',
    cyanGlow: '#4CC9F0',
    steelBlue: '#4682B4',

    // ========================================
    // LIGHT MODE THEME
    // ========================================
    lightMode: {
        primary: '#083D77',
        accent: '#4CC9F0',
        background: '#F5F8FA',
        surface: '#E8F1F8',
        text: '#001524',
        loading: '#083D77',
        cardUser: '#D4E8F7',
        cardBot: '#E0F4FF',
    },

    // ========================================
    // DARK MODE THEME (Primary Focus)
    // ========================================
    darkMode: {
        primary: '#4CC9F0',
        accent: '#4682B4',
        background: '#001524',
        surface: '#0A2540',
        text: '#E8F1F8',
        loading: '#4CC9F0',
        cardUser: '#0A3050',
        cardBot: '#0D2A40',
    },

    // ========================================
    // SEMANTIC COLORS - Status & Feedback
    // ========================================
    semantic: {
        success: '#00CC99',
        error: '#FF4D6A',
        warning: '#FFB347',
        info: '#083D77',
    },

    // ========================================
    // SHIMMER & LOADING EFFECTS
    // ========================================
    shimmer: {
        dark: '#2A4A6A',
        medium: '#4A6A8A',
        light: '#BED3E8',
        veryLight: '#E0ECF5',
    },

    // ========================================
    // FORM CONTROLS - Light Mode
    // ========================================
    formLight: {
        border: '#4682B4',
        borderFocus: '#4CC9F0',
        label: '#083D77',
        labelFloat: '#083D77',
        placeholder: '#4A6A8A',
    },

    // ========================================
    // FORM CONTROLS - Dark Mode
    // ========================================
    formDark: {
        border: '#2A5A8A',
        borderFocus: '#4CC9F0',
        label: '#4CC9F0',
        labelFloat: '#4CC9F0',
        placeholder: '#7DD8F5',
    },

    // ========================================
    // TOGGLES & SWITCHES
    // ========================================
    switches: {
        inactive: '#FF4D6A',
        active: '#00CC99',
    },

    // ========================================
    // HOME DASHBOARD - Light Mode
    // ========================================
    homeLight: {
        background: '#E0ECF5',
        container: '#F5F8FA',
        titleText: '#4682B4',
        tabActive: '#083D77',
        tabInactive: '#4A6A8A',
        // Chart bars
        barLarge: '#083D77',
        barMedium: '#4682B4',
        barSmall: '#4CC9F0',
    },

    // ========================================
    // HOME DASHBOARD - Dark Mode
    // ========================================
    homeDark: {
        background: '#0A2540',
        container: '#001524',
        titleText: '#4682B4',
        tabActive: '#4CC9F0',
        tabInactive: '#2A5A8A',
        // Chart bars with glow effect
        barLarge: '#4CC9F0',
        barMedium: '#4682B4',
        barSmall: '#7DD8F5',
    },

    // ========================================
    // FINANCIAL ICONS & INDICATORS
    // ========================================
    icons: {
        balance: {
            icon: '#083D77',
            backgroundLight: '#D4E8F7',
            backgroundDark: '#0A2A4A',
        },
        expense: {
            icon: '#FF4D6A',
            backgroundLight: '#FFE4E8',
            backgroundDark: '#3A1A2A',
        },
        saving: {
            icon: '#4682B4',
            backgroundLight: '#D4E8F7',
            backgroundDark: '#0A2A4A',
        },
        income: {
            icon: '#00CC99',
            backgroundLight: '#D4F7E8',
            backgroundDark: '#0A3A2A',
        },
    },

    // ========================================
    // GRADIENT PRESETS - Modern Effects
    // ========================================
    gradients: {
        primaryDark: 'linear-gradient(135deg, #001524 0%, #0A2540 100%)',
        primaryLight: 'linear-gradient(135deg, #E8F1F8 0%, #F5F8FA 100%)',
        accent: 'linear-gradient(135deg, #4CC9F0 0%, #083D77 100%)',
        success: 'linear-gradient(135deg, #00CC99 0%, #083D77 100%)',
        error: 'linear-gradient(135deg, #FF4D6A 0%, #3A1A2A 100%)',
        shimmer: 'linear-gradient(90deg, #2A4A6A 0%, #4A6A8A 50%, #2A4A6A 100%)',
    },

    // ========================================
    // GLASSMORPHISM EFFECTS
    // ========================================
    glass: {
        light: 'rgba(232, 241, 248, 0.7)',
        dark: 'rgba(10, 37, 64, 0.7)',
        accent: 'rgba(76, 201, 240, 0.15)',
    },

    // ========================================
    // SHADOWS - Depth & Elevation
    // ========================================
    shadows: {
        sm: '0 1px 2px rgba(0, 21, 36, 0.05)',
        md: '0 4px 6px rgba(0, 21, 36, 0.1)',
        lg: '0 10px 15px rgba(0, 21, 36, 0.15)',
        xl: '0 20px 25px rgba(0, 21, 36, 0.2)',
        glow: '0 0 20px rgba(76, 201, 240, 0.4)',
        glowStrong: '0 0 30px rgba(76, 201, 240, 0.6)',
    },
};

// ========================================
// THEME MANAGER - Dynamic Theme Control
// ========================================
const ThemeManager = {
    currentTheme: 'dark', // Default to dark mode

    /**
     * Set the active theme
     * @param {string} theme - 'light' or 'dark'
     */
    setTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        this.applyThemeToCSSVariables();

        // Store preference
        localStorage.setItem('octomedia-theme', theme);
    },

    /**
     * Get the current theme
     * @returns {string} Current theme ('light' or 'dark')
     */
    getTheme() {
        return this.currentTheme;
    },

    /**
     * Toggle between light and dark themes
     */
    toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
    },

    /**
     * Initialize theme from localStorage or system preference
     */
    initializeTheme() {
        const savedTheme = localStorage.getItem('octomedia-theme');
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
        this.setTheme(theme);
    },

    /**
     * Apply theme colors to CSS custom properties
     */
    applyThemeToCSSVariables() {
        const root = document.documentElement;
        const isDark = this.currentTheme === 'dark';
        const theme = isDark ? ColorPalette.darkMode : ColorPalette.lightMode;
        const homeTheme = isDark ? ColorPalette.homeDark : ColorPalette.homeLight;
        const formTheme = isDark ? ColorPalette.formDark : ColorPalette.formLight;

        // Core theme colors
        root.style.setProperty('--color-primary', theme.primary);
        root.style.setProperty('--color-accent', theme.accent);
        root.style.setProperty('--color-background', theme.background);
        root.style.setProperty('--color-surface', theme.surface);
        root.style.setProperty('--color-text', theme.text);
        root.style.setProperty('--color-loading', theme.loading);
        root.style.setProperty('--color-card-user', theme.cardUser);
        root.style.setProperty('--color-card-bot', theme.cardBot);

        // Semantic colors
        root.style.setProperty('--color-success', ColorPalette.semantic.success);
        root.style.setProperty('--color-error', ColorPalette.semantic.error);
        root.style.setProperty('--color-warning', ColorPalette.semantic.warning);
        root.style.setProperty('--color-info', ColorPalette.semantic.info);

        // Form controls
        root.style.setProperty('--color-border', formTheme.border);
        root.style.setProperty('--color-border-focus', formTheme.borderFocus);
        root.style.setProperty('--color-label', formTheme.label);

        // Home dashboard
        root.style.setProperty('--color-home-bg', homeTheme.background);
        root.style.setProperty('--color-home-container', homeTheme.container);
        root.style.setProperty('--color-tab-active', homeTheme.tabActive);

        // Gradients
        root.style.setProperty('--gradient-primary', isDark ? ColorPalette.gradients.primaryDark : ColorPalette.gradients.primaryLight);
        root.style.setProperty('--gradient-accent', ColorPalette.gradients.accent);

        // Glass effect
        root.style.setProperty('--glass-bg', isDark ? ColorPalette.glass.dark : ColorPalette.glass.light);
    },
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Get color based on current theme
 * @param {string} lightColor - Color for light mode
 * @param {string} darkColor - Color for dark mode
 * @returns {string} Color based on current theme
 */
function getThemedColor(lightColor, darkColor) {
    return ThemeManager.currentTheme === 'dark' ? darkColor : lightColor;
}

/**
 * Create RGBA color from hex with opacity
 * @param {string} hex - Hex color code
 * @param {number} opacity - Opacity value (0-1)
 * @returns {string} RGBA color string
 */
function hexToRGBA(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Get icon colors based on type and theme
 * @param {string} type - 'balance', 'expense', 'saving', or 'income'
 * @returns {object} Icon and background colors
 */
function getIconColors(type) {
    const isDark = ThemeManager.currentTheme === 'dark';
    const iconConfig = ColorPalette.icons[type] || ColorPalette.icons.balance;

    return {
        icon: iconConfig.icon,
        background: isDark ? iconConfig.backgroundDark : iconConfig.backgroundLight,
    };
}

// ========================================
// AUTO-INITIALIZE ON LOAD
// ========================================
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ThemeManager.initializeTheme());
    } else {
        ThemeManager.initializeTheme();
    }
}

// ========================================
// EXPORTS
// ========================================
if (typeof module !== 'undefined' && module.exports) {
    // CommonJS (Node.js)
    module.exports = {
        ColorPalette,
        ThemeManager,
        getThemedColor,
        hexToRGBA,
        getIconColors,
    };
}

// ES6 Module Export
export { ColorPalette, ThemeManager, getThemedColor, hexToRGBA, getIconColors };
export default ColorPalette;
