
// Define platform icons/logos globally to ensure consistency and easy updates
window.PLATFORM_ICONS = {
    shopify: '<svg viewBox="0 0 448 512" width="45" height="45" fill="#95bf47"><path d="M388.32 104.1a4.66 4.66 0 00-4.4-4c-2 0-37.23-.8-37.23-.8s-21.61-20.82-29.62-28.83V503.2l130.73-29.03S388.32 106.08 388.32 104.1zM288.65 70.47a116.67 116.67 0 00-7.21-17.61C271 32.85 255.42 22 237 22a15 15 0 00-4 .4c-.91-1-1.54-2-2.45-3-6.56-7-15-10.26-25.44-9.93-20.86.66-41.6 15.62-58.36 42.1a173.14 173.14 0 00-22.66 64.72s-35.85 11.09-37.85 11.76c-11.42 3.58-11.76 3.92-13.26 14.69-1.25 8.11-31 238.76-31 238.76L278.16 503.2V70.14c-1.17.33-6.57 2-10.51 3.33a79.48 79.48 0 00.97-3zM232.46 83.31l-32.75 10.12a63.67 63.67 0 0112.88-34.25c4.89-6.23 11.83-13.09 20.55-17.26a83.93 83.93 0 01-.68 41.39zM200.64 22c6.23 0 11.42 1.32 15.62 4a58.94 58.94 0 00-22.66 22.32 101.74 101.74 0 00-15.62 47.16l-27.79 8.6c7.56-35.51 32.75-81.78 50.45-82.08z"/></svg>',

    woocommerce: '<svg viewBox="0 0 512 512" width="50" height="45" fill="#96588a"><path d="M47.1 0C21.1 0 0 21.1 0 47.1v289.8c0 26 21.1 47.1 47.1 47.1h113.3l62.5 127.9 62.5-127.9h179.5c26 0 47.1-21.1 47.1-47.1V47.1C512 21.1 490.9 0 464.9 0H47.1zm25.8 73.2c14.3 0 25.9 11.6 25.9 25.9 0 14.3-11.6 25.9-25.9 25.9S47 113.4 47 99.1c0-14.3 11.6-25.9 25.9-25.9zm95.5 0c14.3 0 25.9 11.6 25.9 25.9 0 14.3-11.6 25.9-25.9 25.9s-25.9-11.6-25.9-25.9c0-14.3 11.6-25.9 25.9-25.9zm95.5 0c14.3 0 25.9 11.6 25.9 25.9 0 14.3-11.6 25.9-25.9 25.9s-25.9-11.6-25.9-25.9c0-14.3 11.6-25.9 25.9-25.9zM72.9 163.7h66.9c6.3 0 11.4 5.1 11.4 11.4 0 6.3-5.1 11.4-11.4 11.4H72.9c-6.3 0-11.4-5.1-11.4-11.4 0-6.3 5.1-11.4 11.4-11.4z"/></svg>',

    salla: '<svg viewBox="0 0 24 24" width="45" height="45" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="5" fill="#1BA5A5"/><path d="M7 9L12 6L17 9V18H7V9Z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 18V13H14V18" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    zid: '<svg viewBox="0 0 24 24" width="45" height="45" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="5" fill="#FF6B35"/><path d="M5 10H19V19C19 19.5523 18.5523 20 18 20H6C5.44772 20 5 19.5523 5 19V10Z" stroke="white" stroke-width="1.5"/><path d="M8 10V7C8 5.89543 8.89543 5 10 5H14C15.1046 5 16 5.89543 16 7V10" stroke="white" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="14" r="1.5" fill="white"/></svg>',

    easyorder: '<svg viewBox="0 0 24 24" width="45" height="45" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="5" fill="#10B981"/><path d="M8 4H16C16.5523 4 17 4.44772 17 5V20C17 20.5523 16.5523 21 16 21H8C7.44772 21 7 20.5523 7 20V5C7 4.44772 7.44772 4 8 4Z" stroke="white" stroke-width="1.5"/><path d="M10 9L11 10L14 7" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 13L11 14L14 11" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 17H14" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>',

    custom: '<svg viewBox="0 0 24 24" width="45" height="45" fill="#8b5cf6"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>'
};

// Also define smaller versions if needed
window.PLATFORM_LOGOS_SMALL = {
    shopify: window.PLATFORM_ICONS.shopify.replace('width="45"', 'width="24"').replace('height="45"', 'height="24"'),
    woocommerce: window.PLATFORM_ICONS.woocommerce.replace('width="50"', 'width="26"').replace('height="45"', 'height="24"'),
    salla: window.PLATFORM_ICONS.salla.replace('width="45"', 'width="24"').replace('height="45"', 'height="24"'),
    zid: window.PLATFORM_ICONS.zid.replace('width="45"', 'width="24"').replace('height="45"', 'height="24"'),
    easyorder: window.PLATFORM_ICONS.easyorder.replace('width="45"', 'width="24"').replace('height="45"', 'height="24"'),
    custom: window.PLATFORM_ICONS.custom.replace('width="45"', 'width="24"').replace('height="45"', 'height="24"')
};
