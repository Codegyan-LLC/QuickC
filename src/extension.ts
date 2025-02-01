import { exec } from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let currentDecorationType: vscode.TextEditorDecorationType | undefined;
let errorDecorationType: vscode.TextEditorDecorationType | undefined;
let timeout: NodeJS.Timeout | undefined;

// Default configuration
const defaultConfig = {
    executionDelay: 300, // Delay in milliseconds before executing code
    gccPath: 'gcc', // Path to GCC executable
    inlineColor: 'grey',
};

function activate(context: vscode.ExtensionContext) {
    const textChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            updateOutput(editor);
        }
    });

    const selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection((event) => {
        const editor = event.textEditor;
        updateOutput(editor);
    });

    const blockExecutionDisposable = vscode.commands.registerCommand('quickc.runBlock', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            runSelectedBlock(editor);
        }
    });

    context.subscriptions.push(textChangeDisposable, selectionChangeDisposable, blockExecutionDisposable);
}

function updateOutput(editor: vscode.TextEditor) {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
        const currentLine = editor.selection.active.line;
        const currentLineText = editor.document.lineAt(currentLine).text.trim();
        if (currentLineText.includes('printf') || currentLineText.includes('scanf')) {
            const documentText = editor.document.getText();
            runCCode(documentText, editor, currentLine);
        } else {
            clearOutput(editor);
        }
    }, defaultConfig.executionDelay);
}

function clearOutput(editor: vscode.TextEditor) {
    if (currentDecorationType) {
        editor.setDecorations(currentDecorationType, []);
        currentDecorationType.dispose();
        currentDecorationType = undefined;
    }
    if (errorDecorationType) {
        editor.setDecorations(errorDecorationType, []);
        errorDecorationType.dispose();
        errorDecorationType = undefined;
    }
}

function runCCode(code: string, editor: vscode.TextEditor, currentLine: number) {
    const tempFilePath = path.join(os.tmpdir(), 'quickc.c');
    const outputFilePath = path.join(os.tmpdir(), 'quickc.out');
    fs.writeFileSync(tempFilePath, code);

    const gccPath = vscode.workspace.getConfiguration('quickc').get<string>('gccPath') || defaultConfig.gccPath;
    const startTime = Date.now();

    exec(`${gccPath} "${tempFilePath}" -o "${outputFilePath}" && "${outputFilePath}"`, (error, stdout, stderr) => {
        const endTime = Date.now();
        const executionTime = ((endTime - startTime) / 1000).toFixed(2);

        if (error || stderr) {
            clearOutput(editor);
            displayInlineOutput(`Error: ${stderr.trim() || (error ? error.message : 'Unknown error')}`, editor, currentLine, executionTime, true);
        } else {
            clearOutput(editor);
            displayInlineOutput(stdout.trim(), editor, currentLine, executionTime);
        }

        // Ensure both the temporary source and output files are deleted
        fs.unlink(tempFilePath, (err) => {
            if (err) {
                console.error(`Failed to delete temp source file: ${err.message}`);
            }
        });
        fs.unlink(outputFilePath, (err) => {
            if (err) {
                console.error(`Failed to delete temp output file: ${err.message}`);
            }
        });
    });
}

function runSelectedBlock(editor: vscode.TextEditor) {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    if (!selectedText.trim()) {
        vscode.window.showErrorMessage('No C code selected to execute.');
        return;
    }

    const tempFilePath = path.join(os.tmpdir(), 'quickc_block.c');
    const outputFilePath = path.join(os.tmpdir(), 'quickc_block.out');
    fs.writeFileSync(tempFilePath, selectedText);

    const gccPath = vscode.workspace.getConfiguration('quickc').get<string>('gccPath') || defaultConfig.gccPath;

    exec(`${gccPath} "${tempFilePath}" -o "${outputFilePath}" && "${outputFilePath}"`, (error, stdout, stderr) => {
        if (error || stderr) {
            clearOutput(editor);
            vscode.window.showErrorMessage(stderr.trim() || (error ? error.message : 'Unknown error'));
        } else {
            vscode.window.showInformationMessage(stdout.trim());
        }

        // Ensure both the temporary source and output files are deleted
        fs.unlink(tempFilePath, (err) => {
            if (err) {
                console.error(`Failed to delete temp source file: ${err.message}`);
            }
        });
        fs.unlink(outputFilePath, (err) => {
            if (err) {
                console.error(`Failed to delete temp output file: ${err.message}`);
            }
        });
    });
}

function displayInlineOutput(output: string, editor: vscode.TextEditor, currentLine: number, executionTime: string, isError = false) {
    if (!output.trim()) { return; }
    clearOutput(editor);

    const color = isError ? 'red' : vscode.workspace.getConfiguration('quickc').get<string>('inlineColor') || defaultConfig.inlineColor;
    const formattedOutput = isError ? `Error: ${output} (Execution Time: ${executionTime}s)` : `${output} (Execution Time: ${executionTime}s)`;

    const targetLineText = editor.document.lineAt(currentLine).text;
    const decorations: vscode.DecorationOptions[] = [
        {
            range: new vscode.Range(currentLine, targetLineText.length, currentLine, targetLineText.length),
            renderOptions: {
                after: {
                    contentText: ` // ${formattedOutput}`,
                    color,
                },
            },
        },
    ];

    currentDecorationType = vscode.window.createTextEditorDecorationType({});
    editor.setDecorations(currentDecorationType, decorations);
}

function deactivate() {
    if (currentDecorationType) { currentDecorationType.dispose(); }
    if (errorDecorationType) { errorDecorationType.dispose(); }
}

module.exports = { activate, deactivate };
