/** Recordings as files under `Documents/<directory>`, e.g. `fileRecordingStorage(require('react-native-fs'))`. */
export function fileRecordingStorage(fs, directory = 'tap-recordings') {
    const root = `${fs.DocumentDirectoryPath}/${directory}`;
    const pathFor = (fileName) => `${root}/${fileName.replace(/[/\\]/g, '')}`;
    const ensureRoot = async () => {
        if (!(await fs.exists(root)))
            await fs.mkdir(root);
    };
    return {
        list: async () => {
            await ensureRoot();
            return (await fs.readDir(root)).filter((entry) => entry.isFile()).map((entry) => entry.name);
        },
        read: (fileName) => fs.readFile(pathFor(fileName), 'utf8'),
        write: async (fileName, contents) => {
            await ensureRoot();
            await fs.writeFile(pathFor(fileName), contents, 'utf8');
        },
        remove: async (fileName) => {
            if (await fs.exists(pathFor(fileName)))
                await fs.unlink(pathFor(fileName));
        },
    };
}
/** Recordings kept in memory, until the JS reloads. */
export function memoryRecordingStorage() {
    const files = new Map();
    return {
        list: async () => [...files.keys()],
        read: async (fileName) => {
            const contents = files.get(fileName);
            if (contents === undefined)
                throw new Error(`No recording ${fileName}`);
            return contents;
        },
        write: async (fileName, contents) => {
            files.set(fileName, contents);
        },
        remove: async (fileName) => {
            files.delete(fileName);
        },
    };
}
