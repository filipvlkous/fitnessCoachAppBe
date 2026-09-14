import {
  CatalogueExercise,
  CoachExerciseVersion,
  resolveExerciseForViewer,
} from './exercise-version';

const catalogue: CatalogueExercise = {
  description: 'Catalogue cues',
  img_url: 'https://storage/catalogue.webp',
  video_url: 'https://storage/clip.mp4',
  youtube_url: 'https://youtu.be/catalogue01',
};

const emptyVersion: CoachExerciseVersion = {
  description: null,
  img_url: null,
  youtube_url: null,
};

describe('resolveExerciseForViewer', () => {
  it('serves the catalogue when no coach has written a version', () => {
    expect(resolveExerciseForViewer(catalogue, null)).toEqual({
      description: 'Catalogue cues',
      img_url: 'https://storage/catalogue.webp',
      video_url: 'https://storage/clip.mp4',
      youtube_url: 'https://youtu.be/catalogue01',
    });
  });

  it('lays every field the coach wrote over the catalogue', () => {
    const resolved = resolveExerciseForViewer(catalogue, {
      description: 'Coach cues',
      img_url: 'https://storage/coach.webp',
      youtube_url: 'https://youtu.be/coach000001',
    });

    expect(resolved.description).toBe('Coach cues');
    expect(resolved.img_url).toBe('https://storage/coach.webp');
    expect(resolved.youtube_url).toBe('https://youtu.be/coach000001');
  });

  it('keeps the catalogue image when the coach only wrote cues', () => {
    const resolved = resolveExerciseForViewer(catalogue, {
      ...emptyVersion,
      description: 'Coach cues',
    });

    expect(resolved.description).toBe('Coach cues');
    expect(resolved.img_url).toBe('https://storage/catalogue.webp');
    expect(resolved.youtube_url).toBe('https://youtu.be/catalogue01');
  });

  it('keeps the catalogue cues when the coach only swapped the image', () => {
    const resolved = resolveExerciseForViewer(catalogue, {
      ...emptyVersion,
      img_url: 'https://storage/coach.webp',
    });

    expect(resolved.description).toBe('Catalogue cues');
    expect(resolved.img_url).toBe('https://storage/coach.webp');
  });

  it('treats an empty version exactly like no version', () => {
    expect(resolveExerciseForViewer(catalogue, emptyVersion)).toEqual(
      resolveExerciseForViewer(catalogue, null),
    );
  });

  it('never overrides the uploaded clip, which stays shared', () => {
    const resolved = resolveExerciseForViewer(catalogue, {
      description: 'Coach cues',
      img_url: 'https://storage/coach.webp',
      youtube_url: 'https://youtu.be/coach000001',
    });

    expect(resolved.video_url).toBe('https://storage/clip.mp4');
  });

  it('reports null rather than inventing content when both are empty', () => {
    const bare: CatalogueExercise = {
      description: null,
      img_url: null,
      video_url: null,
      youtube_url: null,
    };

    expect(resolveExerciseForViewer(bare, emptyVersion)).toEqual({
      description: null,
      img_url: null,
      video_url: null,
      youtube_url: null,
    });
  });
});
