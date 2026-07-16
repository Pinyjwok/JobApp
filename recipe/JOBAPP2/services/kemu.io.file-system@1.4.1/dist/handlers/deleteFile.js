import { DataType } from '@kemu-io/hs';
import { unlink, rm, lstat, realpath } from 'node:fs/promises';
import { getDeleteFileDefaultState } from '../common/constants.js';
import { resolve } from 'node:path';
import { homedir, platform } from 'node:os';
/**
 * Checks if a path is a protected directory that should not be deleted
 * @param targetPath - The resolved absolute path to check
 * @returns true if the path is protected, false otherwise
 */
const isProtectedPath = (targetPath) => {
    // Normalize path separators and case
    const normalizedPath = platform() === 'win32'
        ? targetPath.toLowerCase().replace(/\\/g, '/')
        : (platform() === 'darwin' ? targetPath : targetPath); // macOS is case-insensitive, Linux is case-sensitive
    const homeDir = homedir();
    const normalizedHomeDir = platform() === 'win32'
        ? homeDir.toLowerCase().replace(/\\/g, '/')
        : (platform() === 'darwin' ? homeDir : homeDir);
    // Windows protected paths
    if (platform() === 'win32') {
        const protectedPaths = [
            'program files',
            'program files (x86)',
            'programdata',
            'windows',
            'system32',
            'syswow64',
            'users',
        ];
        // Check if path starts with any protected system directory
        // On Windows, paths are like "c:/program files/..." after normalization
        for (const protectedPath of protectedPaths) {
            // Check if path contains protected path at root level after drive letter
            // Pattern: "c:/program files/..." or "c:/windows/..." etc.
            if (normalizedPath.includes(`:/${protectedPath}/`) ||
                normalizedPath.includes(`:/${protectedPath}\\`) ||
                normalizedPath.match(new RegExp(`^[a-z]:[/\\\\]${protectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\]`, 'i')) ||
                normalizedPath.match(new RegExp(`^[a-z]:[/\\\\]${protectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))) {
                return true;
            }
        }
        // Check user's protected directories
        const userProtectedDirs = ['documents', 'downloads', 'desktop', 'pictures', 'videos', 'music'];
        for (const dir of userProtectedDirs) {
            const protectedUserPath = `${normalizedHomeDir}/${dir}`;
            if (normalizedPath.startsWith(protectedUserPath + '/') || normalizedPath === protectedUserPath) {
                return true;
            }
        }
    }
    // macOS protected paths
    if (platform() === 'darwin') {
        const protectedPaths = [
            '/users',
            '/applications',
            '/system',
            '/library',
            '/usr',
            '/etc',
            '/bin',
            '/sbin',
            '/var',
            '/opt',
            '/private',
        ];
        for (const protectedPath of protectedPaths) {
            if (normalizedPath.startsWith(protectedPath + '/') || normalizedPath === protectedPath) {
                return true;
            }
        }
        // Check user's protected directories
        // macOS filesystem is case-insensitive, so normalize case for comparison
        const userProtectedDirs = ['Documents', 'Downloads', 'Desktop', 'Pictures', 'Movies', 'Music', 'Library'];
        for (const dir of userProtectedDirs) {
            const protectedUserPath = `${normalizedHomeDir}/${dir}`;
            const protectedUserPathLower = `${normalizedHomeDir}/${dir.toLowerCase()}`;
            // Check both exact case and lowercase (for case-insensitive filesystem)
            if (normalizedPath.startsWith(protectedUserPath + '/') ||
                normalizedPath === protectedUserPath ||
                normalizedPath.toLowerCase().startsWith(protectedUserPathLower + '/') ||
                normalizedPath.toLowerCase() === protectedUserPathLower) {
                return true;
            }
        }
    }
    // Linux protected paths
    if (platform() === 'linux') {
        const protectedPaths = [
            '/home',
            '/usr',
            '/etc',
            '/bin',
            '/sbin',
            '/root',
            '/var',
            '/opt',
            '/boot',
            '/sys',
            '/proc',
            '/dev',
            '/lib',
            '/lib64',
        ];
        for (const protectedPath of protectedPaths) {
            if (normalizedPath.startsWith(protectedPath + '/') || normalizedPath === protectedPath) {
                return true;
            }
        }
        // Check user's protected directories (case-sensitive on Linux)
        const userProtectedDirs = ['Documents', 'Downloads', 'Desktop', 'Pictures', 'Videos', 'Music'];
        for (const dir of userProtectedDirs) {
            const protectedUserPath = `${homeDir}/${dir}`;
            if (normalizedPath.startsWith(protectedUserPath + '/') || normalizedPath === protectedUserPath) {
                return true;
            }
        }
    }
    return false;
};
/**
 * Deletes a file or directory
 */
export const handleDeleteFile = async (config) => {
    const { event, context, service } = config;
    const state = {
        ...getDeleteFileDefaultState(),
        ...context.currentState,
    };
    if (event.target.portName === 'path') {
        if (event.data.type !== DataType.String || typeof event.data.value !== 'string') {
            throw new Error('Path must be a string');
        }
        state.path = event.data.value.trim();
        return context.setState(state);
    }
    // Handle trigger
    if (event.target.portName === 'delete') {
        if (!state.path) {
            throw new Error('Missing file path');
        }
        try {
            const [parsedPath] = await service.helpers.parseExpressions({
                expressions: [
                    { text: state.path }
                ],
                widgetId: context.widgetId,
            });
            const parsedPathTrimmed = parsedPath.trim();
            // Ensure we have a non-empty path
            if (!parsedPathTrimmed) {
                throw new Error('Path cannot be empty');
            }
            // Resolve to absolute path (handles relative paths and path traversal)
            const resolvedPath = resolve(parsedPathTrimmed);
            // Check if the resolved path itself is a symlink (before following it)
            // Reject symlinks entirely for security to prevent symlink swap attacks
            let linkStats;
            try {
                linkStats = await lstat(resolvedPath);
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    throw new Error('NO_SUCH_FILE_OR_DIRECTORY');
                }
                throw error;
            }
            if (linkStats.isSymbolicLink()) {
                throw new Error('Cannot delete symlinks for security reasons');
            }
            // Resolve symlinks to get the real path (prevents symlink attacks)
            // This also normalizes the path and resolves any intermediate symlinks
            let realPath;
            try {
                realPath = await realpath(resolvedPath);
            }
            catch (error) {
                // If realpath fails but lstat succeeded, use the resolved path
                // (This handles edge cases where realpath might fail)
                realPath = resolvedPath;
            }
            // Check if the real path (after resolving symlinks) is protected
            if (isProtectedPath(realPath)) {
                throw new Error('Cannot delete protected system or user directory');
            }
            // Double-check: also verify the resolved path before symlink resolution
            // This prevents attacks where someone creates a symlink after we check
            if (isProtectedPath(resolvedPath)) {
                throw new Error('Cannot delete protected system or user directory');
            }
            // Get file stats for the real path
            let stats;
            try {
                stats = await lstat(realPath);
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    throw new Error('NO_SUCH_FILE_OR_DIRECTORY');
                }
                throw error;
            }
            // Check if it's a directory
            const isDirectory = stats.isDirectory();
            if (isDirectory && !state.allowDeleteDirectories) {
                throw new Error('Cannot delete directory. Enable "Allow Delete Directories" in settings to delete directories.');
            }
            // Final check: verify the path still resolves to the same location
            // This prevents TOCTOU (Time-Of-Check-Time-Of-Use) attacks
            let finalRealPath;
            try {
                finalRealPath = await realpath(resolvedPath);
            }
            catch (error) {
                // If we can't resolve it now, something changed - abort
                throw new Error('Path resolution changed during operation - aborting for security');
            }
            if (finalRealPath !== realPath) {
                throw new Error('Path changed during operation - aborting for security');
            }
            // Delete the file or directory using the real path
            if (isDirectory) {
                await rm(finalRealPath, { recursive: true, force: true });
            }
            else {
                await unlink(finalRealPath);
            }
            // No outputs for this variant
            return;
        }
        catch (error) {
            console.error(error);
            throw error;
        }
    }
};
//# sourceMappingURL=deleteFile.js.map