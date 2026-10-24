import type { Recording } from '../shared/protocol';
import { editedRecording, playbackTimes, screenDistance } from './recording_edits';

const recording: Recording = {
  name: 'Journey',
  createdAt: '2026-10-23T00:00:00.000Z',
  screen: { width: 402, height: 874, scale: 3 },
  startScreen: 'HomeTab/FeedScreen',
  endScreen: 'ProfileTab/UserProfileScreen',
  events: [
    { x: 10, y: 10, t: 0, screen: 'HomeTab/FeedScreen' },
    { x: 20, y: 20, t: 1000, screen: 'HomeTab/PostScreen' },
    { x: 30, y: 30, t: 2500, screen: 'SearchTab/ResultsScreen#All' },
    { x: 40, y: 40, t: 4000, screen: 'ProfileTab/SettingsScreen' },
  ],
};

describe('editedRecording', () => {
  it('removes touches by number and keeps the rest’s times', () => {
    const edited = editedRecording(recording, { remove: [2] });
    expect(edited.events.map((event) => event.x)).toEqual([10, 30, 40]);
    expect(edited.events.map((event) => event.t)).toEqual([0, 2500, 4000]);
    expect(edited.startScreen).toBe(recording.startScreen);
    expect(edited.endScreen).toBe(recording.endScreen);
  });

  it('starts where its new first touch was made when the first is removed', () => {
    const edited = editedRecording(recording, { remove: [1] });
    expect(edited.startScreen).toBe('HomeTab/PostScreen');
    expect(edited.events[0].t).toBe(0);
    expect(edited.events[1].t).toBe(1500);
  });

  it('ends where the first cut touch was made', () => {
    const edited = editedRecording(recording, { keepFirst: 2 });
    expect(edited.events).toHaveLength(2);
    expect(edited.endScreen).toBe('SearchTab/ResultsScreen#All');
  });

  it('cuts after removing', () => {
    expect(editedRecording(recording, { remove: [1], keepFirst: 1 }).events.map((event) => event.x)).toEqual([20]);
  });

  it('refuses to leave no touches', () => {
    expect(() => editedRecording(recording, { keepFirst: 0 })).toThrow();
  });
});

describe('playbackTimes', () => {
  const events = [{ t: 0 }, { t: 1000 }, { t: 9000 }, { t: 9500 }];

  it('plays at the recorded times by default', () => {
    expect(playbackTimes(events)).toEqual([0, 1000, 9000, 9500]);
  });

  it('spaces every touch evenly with gapMs', () => {
    expect(playbackTimes(events, { gapMs: 2000 })).toEqual([0, 2000, 4000, 6000]);
  });

  it('shortens only the long gaps with maxGapMs', () => {
    expect(playbackTimes(events, { maxGapMs: 3000 })).toEqual([0, 1000, 4000, 4500]);
  });
});

describe('screenDistance', () => {
  it('tells another sub-tab of the same screen from another screen', () => {
    expect(screenDistance('SearchTab/ResultsScreen#All', 'SearchTab/ResultsScreen#All')).toBe('same');
    expect(screenDistance('SearchTab/ResultsScreen#People', 'SearchTab/ResultsScreen#Posts')).toBe('subtab');
    expect(screenDistance('SearchTab/ResultsScreen#All', 'InboxTab/ThreadScreen')).toBe('route');
    expect(screenDistance('SearchTab/ResultsScreen', null)).toBe('route');
  });

  it('counts a sub-tab the screen hasn’t reported as the same', () => {
    expect(screenDistance('SearchTab/ResultsScreen#People', 'SearchTab/ResultsScreen')).toBe('same');
  });
});
