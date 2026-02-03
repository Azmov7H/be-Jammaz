import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

export const ExportService = {
    /**
     * Generate Excel Buffer
     * @param {Array} data - Array of objects
     * @param {Array} columns - Array of { header, key, width }
     * @param {String} sheetName
     */
    async generateExcel(data, columns, sheetName = 'Data') {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(sheetName);

        // Styling
        worksheet.columns = columns.map(col => ({
            ...col,
            style: { font: { name: 'Arial' } } // Fallback font
        }));

        // Add Header Row Styling
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2563EB' } // Primary Blue
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

        // Add Data
        worksheet.addRows(data);

        // Auto-filter
        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: columns.length }
        };

        // Generate Buffer
        const buffer = await workbook.xlsx.writeBuffer();
        return buffer;
    },

    /**
     * Generate PDF (Client-side usually, but this is server logic)
     * Note: Better done on client for precise UI matching, but acceptable here for data dumps.
     */
    async generatePDF(data, columns, title = 'Report') {
        // Implementation for server-side PDF if needed.
        // For now, we'll focus on Excel as it's the primary request for "Export Data".
        // Client-side PDF is usually handled by the component.
        throw new Error('PDF generation should be handled on client-side for better styling control');
    }
};



