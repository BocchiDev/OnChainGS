import colors from 'ansi-colors';

export function formatConsoleOutput() {
    const divider = colors.gray('='.repeat(50));
    const sectionDivider = colors.gray('-'.repeat(40));
    
    return {
        divider,
        sectionDivider,
        title: (text) => colors.bold(colors.blue(`\n${text}`)),
        subtitle: (text) => colors.cyan(`\n${text}`),
        info: (label, value) => `${colors.gray('>')} ${colors.yellow(label)}: ${colors.white(value)}`,
        success: (text) => `${colors.green('✓')} ${colors.green(text)}`,
        error: (text) => `${colors.red('✗')} ${colors.red(text)}`,
        warning: (text) => `${colors.yellow('⚠')} ${colors.yellow(text)}`,
        progress: (current, total, label) => `${colors.gray('>')} ${label}: ${colors.cyan(current)}/${colors.cyan(total)}`
    };
}