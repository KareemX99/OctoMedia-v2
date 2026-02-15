/**
 * DK-OctoBot Client Protection
 * يمنع: Right-click, Inspect, F12, Keyboard shortcuts, Console access
 */

(function () {
    'use strict';

    // ============= DISABLE RIGHT CLICK =============
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        return false;
    });

    // ============= DISABLE KEYBOARD SHORTCUTS =============
    document.addEventListener('keydown', function (e) {
        // F12 - Developer Tools
        if (e.key === 'F12' || e.keyCode === 123) {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+I - Inspect Element
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.keyCode === 73)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+J - Console
        if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j' || e.keyCode === 74)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+C - Inspect Element
        if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.keyCode === 67)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+U - View Source
        if (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+S - Save Page
        if (e.ctrlKey && (e.key === 'S' || e.key === 's' || e.keyCode === 83)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+P - Print
        if (e.ctrlKey && (e.key === 'P' || e.key === 'p' || e.keyCode === 80)) {
            e.preventDefault();
            return false;
        }
    });

    // ============= DISABLE TEXT SELECTION (Optional) =============
    // Uncomment the following lines to disable text selection
    /*
    document.addEventListener('selectstart', function(e) {
        e.preventDefault();
        return false;
    });
    */

    // ============= DETECT DEVELOPER TOOLS =============
    let devToolsOpen = false;

    // Method 1: Check window size difference
    const threshold = 160;
    const checkDevTools = function () {
        const widthThreshold = window.outerWidth - window.innerWidth > threshold;
        const heightThreshold = window.outerHeight - window.innerHeight > threshold;

        if (widthThreshold || heightThreshold) {
            if (!devToolsOpen) {
                devToolsOpen = true;
                console.clear();
                console.log('%c⚠️ تحذير أمني!', 'color: red; font-size: 30px; font-weight: bold;');
                console.log('%cهذه المنطقة مخصصة للمطورين فقط.', 'color: orange; font-size: 16px;');
                console.log('%cإذا طلب منك شخص نسخ أو لصق شيء هنا، فهذا احتيال.', 'color: red; font-size: 14px;');
            }
        } else {
            devToolsOpen = false;
        }
    };

    setInterval(checkDevTools, 1000);

    // Method 2: Debug detection
    (function () {
        const element = new Image();
        Object.defineProperty(element, 'id', {
            get: function () {
                devToolsOpen = true;
                console.clear();
            }
        });
    })();

    // ============= CONSOLE PROTECTION =============
    // Clear console on load
    console.clear();

    // Override console methods (optional - can break debugging)
    /*
    const noop = function() {};
    ['log', 'debug', 'info', 'warn', 'error', 'table', 'trace'].forEach(function(method) {
        console[method] = noop;
    });
    */

    // ============= DISABLE DRAG =============
    document.addEventListener('dragstart', function (e) {
        e.preventDefault();
        return false;
    });

    // ============= PROTECTION MESSAGE =============
    console.log('%c🛡️ DK-OctoBot Protected', 'color: #E91E63; font-size: 20px; font-weight: bold;');
    console.log('%c© 2024 DK-OctoBot. All rights reserved.', 'color: gray; font-size: 12px;');

})();
