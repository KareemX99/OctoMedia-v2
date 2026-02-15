const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

class GoogleSheetsService {
    constructor() {
        this.auth = null;
        this.sheets = null;
        this.isReady = false;
        this.init();
    }

    async init() {
        try {
            // Path to your service account key file
            // Expecting 'service-account.json' in the root directory
            const KEY_FILE_PATH = path.join(__dirname, '../service-account.json');

            if (!fs.existsSync(KEY_FILE_PATH)) {
                console.warn('[GoogleSheets] Service account file not found at:', KEY_FILE_PATH);
                console.warn('[GoogleSheets] Please download your JSON key from Google Cloud Console and save it as "service-account.json" in the root directory.');
                return;
            }

            this.auth = new google.auth.GoogleAuth({
                keyFile: KEY_FILE_PATH,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.client = await this.auth.getClient();
            this.sheets = google.sheets({ version: 'v4', auth: this.client });
            this.isReady = true;
            console.log('[GoogleSheets] Service initialized successfully');
        } catch (error) {
            console.error('[GoogleSheets] Initialization failed:', error.message);
        }
    }

    async checkReady() {
        if (!this.isReady) await this.init();
        if (!this.isReady) throw new Error('Google Sheets Service is not initialized. Check server logs for "service-account.json" errors.');
    }

    /**
     * Get values from a spreadsheet
     * @param {string} spreadsheetId 
     * @param {string} range e.g. 'Sheet1!A1:Z100'
     */
    async getSheetData(spreadsheetId, range) {
        await this.checkReady();
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId,
                range,
            });
            return response.data.values || [];
        } catch (error) {
            console.error('[GoogleSheets] Get data failed:', error.message);
            throw error;
        }
    }

    /**
     * Update values in a spreadsheet
     * @param {string} spreadsheetId 
     * @param {string} range e.g. 'Sheet1!A1'
     * @param {Array<Array<any>>} values 
     */
    async updateSheetData(spreadsheetId, range, values) {
        await this.checkReady();
        try {
            const resource = { values };
            const response = await this.sheets.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED', // Allows formulas and formatting inference
                resource,
            });
            return response.data;
        } catch (error) {
            console.error('[GoogleSheets] Update data failed:', error.message);
            throw error;
        }
    }

    /**
     * Append values to a spreadsheet
     * @param {string} spreadsheetId 
     * @param {string} range 
     * @param {Array<Array<any>>} values 
     */
    async appendSheetData(spreadsheetId, range, values) {
        await this.checkReady();
        try {
            const resource = { values };
            const response = await this.sheets.spreadsheets.values.append({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                resource,
            });
            return response.data;
        } catch (error) {
            console.error('[GoogleSheets] Append data failed:', error.message);
            throw error;
        }
    }

    /**
     * Get spreadsheet metadata (title, sheets, etc.)
     * @param {string} spreadsheetId 
     */
    async getSpreadsheetInfo(spreadsheetId) {
        await this.checkReady();
        try {
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId
            });
            return response.data;
        } catch (error) {
            console.error('[GoogleSheets] Get info failed:', error.message);
            throw error;
        }
    }
}

module.exports = new GoogleSheetsService();
