/* global jest, describe, it, expect */

jest.mock('../config/api', () => ({
  buildApiUrl: (path) => path,
  getJson: jest.fn(),
  postJson: jest.fn(),
}));

const { fetchPracticeWords } = require('./wordsService');

describe('fetchPracticeWords personalization fallback', () => {
  it('uses ranked words without calling the ordinary loader when personalization succeeds', async () => {
    const personalized = jest.fn().mockResolvedValue(['radyo', 'dahon']);
    const ordinary = jest.fn().mockResolvedValue(['bata']);

    await expect(fetchPracticeWords('intermediate', 10, personalized, ordinary))
      .resolves.toEqual(['radyo', 'dahon']);
    expect(ordinary).not.toHaveBeenCalled();
  });

  it('returns the ordinary level bank when the personalization endpoint fails', async () => {
    const personalized = jest.fn().mockRejectedValue(new Error('simulated endpoint failure'));
    const ordinary = jest.fn().mockResolvedValue(['bata', 'dahon']);

    await expect(fetchPracticeWords('beginner', 24, personalized, ordinary))
      .resolves.toEqual(['bata', 'dahon']);
    expect(ordinary).toHaveBeenCalledWith('beginner', 24);
  });

  it('also falls back when personalization returns an empty list', async () => {
    const personalized = jest.fn().mockResolvedValue([]);
    const ordinary = jest.fn().mockResolvedValue(['bata']);

    await expect(fetchPracticeWords('beginner', 5, personalized, ordinary))
      .resolves.toEqual(['bata']);
  });
});
