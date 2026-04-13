const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

function createDiscordPresenceService({ token, userId, serverId, logger = console }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
    ],
  });

  let ready = false;
  let cachedUserProfile = null;
  let cachedUserProfileAt = 0;

  function toEpochMs(value) {
    if (!value) return null;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function formatSpotify(activity) {
    return {
      song: activity.details || null,
      artist: activity.state || null,
      album: activity.assets?.largeText || null,
      trackId: activity.syncId || null,
      startedAt: activity.timestamps?.start || null,
      endsAt: activity.timestamps?.end || null,
      albumArtUrl: activity.assets?.largeImageURL?.() || null,
    };
  }

  function getSpotifyFromPresence(presence) {
    const activities = presence?.activities || [];
    const spotify = activities.find(
      (activity) => activity.type === ActivityType.Listening && activity.name === 'Spotify',
    );

    if (!spotify) return null;
    return formatSpotify(spotify);
  }

  async function fetchMemberPresence() {
    const guild = await client.guilds.fetch(serverId);
    const member = await guild.members.fetch({ user: userId, force: true });
    return member;
  }

  function mapActivity(activity) {
    return {
      type: typeof activity.type === 'number' ? activity.type : null,
      state: activity.state || null,
      details: activity.details || null,
      name: activity.name || null,
      emoji: activity.emoji
        ? {
            id: activity.emoji.id || null,
            name: activity.emoji.name || null,
            animated: Boolean(activity.emoji.animated),
          }
        : null,
      timestamps: activity.timestamps
        ? {
            start: toEpochMs(activity.timestamps.start),
            end: toEpochMs(activity.timestamps.end),
          }
        : null,
    };
  }

  async function getUserProfile(member) {
    if (cachedUserProfile && Date.now() - cachedUserProfileAt < 5 * 60 * 1000) {
      return cachedUserProfile;
    }

    const fetchedUser = await member.user.fetch(true);
    cachedUserProfile = fetchedUser;
    cachedUserProfileAt = Date.now();
    return fetchedUser;
  }

  function mapDiscordUser(user) {
    const primaryGuild = user.primaryGuild
      ? {
          identity_guild_id: user.primaryGuild.identityGuildId,
          identity_enabled: Boolean(user.primaryGuild.identityEnabled),
          tag: user.primaryGuild.tag || null,
          badge: user.primaryGuild.badge || null,
        }
      : null;

    return {
      id: user.id,
      username: user.username,
      global_name: user.globalName || null,
      avatar: user.avatar || null,
      avatar_decoration_data: user.avatarDecorationData
        ? { asset: user.avatarDecorationData.asset }
        : null,
      primary_guild: primaryGuild,
    };
  }

  async function getPresenceSnapshot() {
    const member = await fetchMemberPresence();
    const presence = member.presence || null;
    const activities = presence?.activities || [];
    const spotifyActivity = activities.find(
      (activity) => activity.type === ActivityType.Listening && activity.name === 'Spotify',
    );
    const spotify = spotifyActivity
      ? {
          song: spotifyActivity.details || null,
          artist: spotifyActivity.state || null,
          album: spotifyActivity.assets?.largeText || null,
          track_id: spotifyActivity.syncId || null,
          album_art_url: spotifyActivity.assets?.largeImageURL?.() || null,
          timestamps: {
            start: toEpochMs(spotifyActivity.timestamps?.start),
            end: toEpochMs(spotifyActivity.timestamps?.end),
          },
        }
      : null;

    let userProfile = member.user;
    try {
      userProfile = await getUserProfile(member);
    } catch {
      userProfile = member.user;
    }

    return {
      discord_status: presence?.status || 'offline',
      active_on_discord_web: Boolean(presence?.clientStatus?.web),
      active_on_discord_desktop: Boolean(presence?.clientStatus?.desktop),
      active_on_discord_mobile: Boolean(presence?.clientStatus?.mobile),
      active_on_discord_embedded: false,
      active_on_discord_vr: false,
      listening_to_spotify: Boolean(spotify),
      spotify,
      activities: activities.map(mapActivity),
      discord_user: mapDiscordUser(userProfile),
      kv: {
        banner: userProfile.banner || null,
      },
      fetched_at: new Date().toISOString(),
    };
  }

  async function getNowPlaying() {
    const member = await fetchMemberPresence();
    const spotify = getSpotifyFromPresence(member.presence || null);

    return {
      isListening: Boolean(spotify),
      status: member.presence?.status || 'offline',
      nowPlaying: spotify,
      fetchedAt: new Date().toISOString(),
    };
  }

  async function start() {
    if (ready) return;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Discord client ready timeout'));
      }, 15000);

      const onReady = () => {
        clearTimeout(timeout);
        ready = true;
        logger.info(`[discord] Connected as ${client.user.tag}`);
        client.off('error', onError);
        resolve();
      };

      const onError = (error) => {
        clearTimeout(timeout);
        client.off('clientReady', onReady);
        reject(error);
      };

      client.once('clientReady', onReady);
      client.once('error', onError);

      client.login(token).catch((error) => {
        clearTimeout(timeout);
        client.off('clientReady', onReady);
        client.off('error', onError);
        reject(error);
      });
    });
  }

  async function stop() {
    ready = false;
    if (client) client.destroy();
  }

  client.on('error', (error) => {
    logger.error('[discord] Client error:', error.message);
  });

  client.on('warn', (warning) => {
    logger.warn('[discord] Warning:', warning);
  });

  return {
    start,
    stop,
    getNowPlaying,
    getPresenceSnapshot,
    isReady: () => ready,
  };
}

module.exports = { createDiscordPresenceService };
