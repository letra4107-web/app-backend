require('dotenv').config();

const PRODUCTION_BACKEND_URL = 'https://app-backend-production-7738.up.railway.app';
const envAndroidPackage = process.env.ANDROID_PACKAGE || process.env.EXPO_ANDROID_PACKAGE;
const configuredApiUrl = PRODUCTION_BACKEND_URL;

module.exports = ({ config }) => {
  const androidPackage = envAndroidPackage || config.android?.package;

  const androidPackageIsValid =
    typeof androidPackage === 'string' &&
    /^[a-zA-Z][a-zA-Z0-9_.]*\.[a-zA-Z0-9_.]+$/.test(androidPackage);

  if (!androidPackageIsValid) {
    throw new Error(
      'android.package is not defined or invalid. Set android.package in app.config.js or set ANDROID_PACKAGE in environment.'
    );
  }

  const expoBuildPropertiesPlugin = [
    'expo-build-properties',
    {
      android: {
        minSdkVersion: 24,
        ndkVersion: '27.1.12297006',
        gradleProperties: {
          'org.gradle.daemon': 'false',
          'org.gradle.parallel': 'false',
          'org.gradle.jvmargs': '-Xmx2048m -Dfile.encoding=UTF-8 -XX:MaxMetaspaceSize=512m',
        },
      },
    },
  ];

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      expoBuildPropertiesPlugin,
      'expo-font',
      [
        'expo-audio',
        {
          microphonePermission: 'Kinakailangan ang mikropono para sa voice practice at pagkilala ng boses.',
        },
      ],
    ],
    assetBundlePatterns: config.assetBundlePatterns ?? ['**/*'],
    android: {
      ...config.android,
      package: androidPackage,
    },
    extra: {
      ...(config.extra || {}),
      eas: {
        projectId: "153e47e5-7a90-480b-ab99-2bada18510e8"   // 🔑 Added EAS project ID
      },
      EXPO_PUBLIC_API_URL:
        configuredApiUrl,
      EXPO_PUBLIC_BASE_URL:
        configuredApiUrl,
      API_BASE_URL:
        configuredApiUrl,
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    },
  };
};
