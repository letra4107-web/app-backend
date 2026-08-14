import { ImageSourcePropType } from 'react-native';
import { ACHIEVEMENTS } from '../services/achievementService';

export const DEFAULT_STUDENT_AVATARS = [
  { key: 'default:reader', label: 'Reader', image: require('../../assets/learnboypng.webp') },
  { key: 'default:book', label: 'Book', image: require('../../assets/book.webp') },
  { key: 'default:star', label: 'Star', image: require('../../assets/thumbsup.webp') },
  { key: 'default:trophy', label: 'Trophy', image: require('../../assets/trophy.webp') },
] as const;

export const STUDENT_MODULE_AVATARS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/modyul/modyul1.png'),
  2: require('../../assets/modyul/modyul2.png'),
  3: require('../../assets/modyul/modyul3.png'),
  4: require('../../assets/modyul/modyul4.png'),
  5: require('../../assets/modyul/modyul5.png'),
  6: require('../../assets/modyul/modyul6.png'),
  7: require('../../assets/modyul/modyul7.png'),
  8: require('../../assets/modyul/modyul8.png'),
  9: require('../../assets/modyul/modyul9.png'),
  10: require('../../assets/modyul/modyul10.png'),
  11: require('../../assets/modyul/modyul11.png'),
  12: require('../../assets/modyul/modyul12.png'),
  13: require('../../assets/modyul/modyul13.png'),
  14: require('../../assets/modyul/modyul14.png'),
  15: require('../../assets/modyul/modyul15.png'),
  16: require('../../assets/modyul/modyul16.png'),
  17: require('../../assets/modyul/modyul17.png'),
};

export const studentAvatarSource = (
  avatarKey?: string | null,
  avatarUrl?: string | null,
): ImageSourcePropType | null => {
  if (avatarKey?.startsWith('badge:')) {
    const badge = ACHIEVEMENTS.find((item) => item.id === avatarKey.slice('badge:'.length));
    if (badge) return badge.image;
  }
  if (avatarKey?.startsWith('module:')) {
    const moduleNumber = Number(avatarKey.slice('module:'.length));
    if (Number.isInteger(moduleNumber) && STUDENT_MODULE_AVATARS[moduleNumber]) {
      return STUDENT_MODULE_AVATARS[moduleNumber];
    }
  }
  const preset = DEFAULT_STUDENT_AVATARS.find((item) => item.key === avatarKey);
  if (preset) return preset.image;
  return avatarUrl ? { uri: avatarUrl } : null;
};
