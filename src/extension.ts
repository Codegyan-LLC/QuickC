import { exec } from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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
        const documentText = editor.document.getText();
        const lines = documentText.split('\n');

        let targetLine = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('printf') || lines[i].includes('scanf')) {
                targetLine = i;
                break;
            }
        }

        if (targetLine !== -1) {
            runCCode(documentText, editor, targetLine);
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
    const documentPath = editor.document.uri.fsPath; // Get the actual file path
    const tempFilePath = path.join(__dirname, 'quickc.c');
    const outputFilePath = path.join(__dirname, 'quickc.out');
    fs.writeFileSync(tempFilePath, code);

    const gccPath = vscode.workspace.getConfiguration('quickc').get<string>('gccPath') || defaultConfig.gccPath;
    const startTime = Date.now();

    exec(`${gccPath} "${tempFilePath}" -o "${outputFilePath}" && "${outputFilePath}"`, (error, stdout, stderr) => {
        const endTime = Date.now();
        const executionTime = ((endTime - startTime) / 1000).toFixed(2);

        if (error || stderr) {
            clearOutput(editor);
            const formattedError = stderr.replace(tempFilePath, documentPath);
            displayInlineOutput(` ${formattedError.trim() || (error ? error.message : 'Unknown error')}`, editor, currentLine, executionTime, true);
        } else {
            clearOutput(editor);
            displayInlineOutput(stdout.trim(), editor, currentLine, executionTime);
        }

        fs.unlinkSync(tempFilePath);
        if (fs.existsSync(outputFilePath)) {
            fs.unlinkSync(outputFilePath);
        }
    });
}

function runSelectedBlock(editor: vscode.TextEditor) {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    if (!selectedText.trim()) {
        vscode.window.showErrorMessage('No C code selected to execute.');
        return;
    }

    const documentPath = editor.document.uri.fsPath; 
    const tempFilePath = path.join(__dirname, 'quickc_block.c');
    const outputFilePath = path.join(__dirname, 'quickc_block.out');
    fs.writeFileSync(tempFilePath, selectedText);

    const gccPath = vscode.workspace.getConfiguration('quickc').get<string>('gccPath') || defaultConfig.gccPath;

    exec(`${gccPath} "${tempFilePath}" -o "${outputFilePath}" && "${outputFilePath}"`, (error, stdout, stderr) => {
		const documentPath = editor.document.uri.fsPath; // Actual file path
	
		if (error || stderr) {
			clearOutput(editor);
			
			const formattedError = stderr.replace(new RegExp(tempFilePath, 'g'), documentPath);
			
			vscode.window.showErrorMessage(formattedError.trim() || (error ? error.message : 'Unknown error'));
		} else {
			// Remove unnecessary headers like #include from stdout
			const cleanedOutput = stdout
				.split('\n')
				.filter(line => !line.trim().startsWith('#include'))
				.join('\n');
	
			vscode.window.showInformationMessage(cleanedOutput.trim());
		}
	
		fs.unlinkSync(tempFilePath);
		if (fs.existsSync(outputFilePath)) {
			fs.unlinkSync(outputFilePath);
		}
	});
}

function displayInlineOutput(output: string, editor: vscode.TextEditor, currentLine: number, executionTime: string, isError = false) {
    if (!output.trim()) { return; }
    clearOutput(editor);

    // Remove any lines starting with #include
    const cleanedOutput = output
        .split('\n')
        .filter(line => !line.trim().startsWith('#include'))
        .join('\n');

    const color = isError ? 'red' : vscode.workspace.getConfiguration('quickc').get<string>('inlineColor') || defaultConfig.inlineColor;
    const formattedOutput = isError 
        ? `Error: ${cleanedOutput} (Execution Time: ${executionTime}s)` 
        : `${cleanedOutput} (Execution Time: ${executionTime}s)`;

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
