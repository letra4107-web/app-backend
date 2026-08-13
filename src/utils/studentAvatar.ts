import { ImageSourcePropType } from 'react-native';
import { ACHIEVEMENTS } from '../services/achievementService';

export const DEFAULT_STUDENT_AVATARS = [
  { key: 'default:reader', label: 'Reader', image: require('../../assets/learnboypng.webp') },
  { key: 'default:book', label: 'Book', image: require('../../assets/book.webp') },
  { key: 'default:star', label: 'Star', image: require('../../assets/thumbsup.webp') },
  { key: 'default:trophy', label: 'Trophy', image: require('../../assets/trophy.webp') },
] as const;

export const studentAvatarSource = (
  avatarKey?: string | null,
  avatarUrl?: string | null,
): ImageSourcePropType | null => {
  if (avatarKey?.startsWith('badge:')) {
    const badge = ACHIEVEMENTS.find((item) => item.id === avatarKey.slice('badge:'.length));
    if (badge) return badge.image;
  }
  const preset = DEFAULT_STUDENT_AVATARS.find((item) => item.key === avatarKey);
  if (preset) return preset.image;
  return avatarUrl ? { uri: avatarUrl } : null;
};
