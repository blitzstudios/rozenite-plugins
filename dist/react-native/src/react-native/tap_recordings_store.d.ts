import type { Recording, RecordingEdit, RecordingSummary } from '../shared/protocol';
export declare function writeRecording(recording: Recording): Promise<RecordingSummary>;
/** Newest first, skipping files that don't parse. */
export declare function listRecordings(): Promise<RecordingSummary[]>;
export declare function readRecording(fileName: string): Promise<Recording>;
export declare function renameRecording(fileName: string, name: string): Promise<void>;
/** Removes or cuts touches in place, keeping the file name. */
export declare function editRecording(fileName: string, edit: RecordingEdit): Promise<RecordingSummary>;
export declare function deleteRecording(fileName: string): Promise<void>;
/** Saves a recording pasted as JSON, under a new file name. */
export declare function importRecording(json: string): Promise<RecordingSummary>;
