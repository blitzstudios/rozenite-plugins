import type { RecordingStorage } from './config';
/** The part of `react-native-fs` the file storage uses. */
export type RecordingFileSystem = {
    DocumentDirectoryPath: string;
    exists: (path: string) => Promise<boolean>;
    mkdir: (path: string) => Promise<void>;
    readDir: (path: string) => Promise<Array<{
        name: string;
        isFile: () => boolean;
    }>>;
    readFile: (path: string, encoding: 'utf8') => Promise<string>;
    writeFile: (path: string, contents: string, encoding: 'utf8') => Promise<void>;
    unlink: (path: string) => Promise<void>;
};
/** Recordings as files under `Documents/<directory>`, e.g. `fileRecordingStorage(require('react-native-fs'))`. */
export declare function fileRecordingStorage(fs: RecordingFileSystem, directory?: string): RecordingStorage;
/** Recordings kept in memory, until the JS reloads. */
export declare function memoryRecordingStorage(): RecordingStorage;
