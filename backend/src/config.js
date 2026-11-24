const env = process.env;
export const cfg = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT) || 4000,
  region: env.AWS_REGION || 'ap-south-1',
  jwtSecret: env.JWT_SECRET || (env.NODE_ENV === 'production' ? '' : 'dev-only-secret-change-me-0000000000'),
  bucket: env.PHOTO_BUCKET || '',
  topicArn: env.SNS_TOPIC_ARN || '',
  priorityFn: env.PRIORITY_LAMBDA || '',
};
if (cfg.env === 'production' && (cfg.jwtSecret.length < 32 || !cfg.bucket))
  throw new Error('Production requires JWT_SECRET (32+ chars) and PHOTO_BUCKET');

// category -> display label, default responsible team
export const CATEGORIES = {
  pothole:        { label: 'Pothole',             team: 'roads' },
  road_hazard:    { label: 'Road hazard',         team: 'roads' },
  drain_blockage: { label: 'Blocked drain',       team: 'drainage' },
  water_leak:     { label: 'Water leak',          team: 'drainage' },
  streetlight:    { label: 'Streetlight fault',   team: 'lighting' },
  fallen_tree:    { label: 'Fallen tree',         team: 'sanitation' },
  garbage:        { label: 'Uncollected garbage', team: 'sanitation' },
  graffiti:       { label: 'Graffiti',            team: 'sanitation' },
};
// Sample locations (no GPS needed)
export const LOCATIONS = [
  { id: 'central-market', name: 'Central Market' },
  { id: 'riverside',      name: 'Riverside Quarter' },
  { id: 'old-town',       name: 'Old Town' },
  { id: 'tech-park',      name: 'Tech Park' },
  { id: 'lakeview',       name: 'Lakeview Colony' },
  { id: 'station-road',   name: 'Station Road' },
  { id: 'university',     name: 'University Campus' },
  { id: 'harbour-east',   name: 'Harbour East' },
];
export const TEAMS = [
  { id: 'roads',      name: 'Roads & Pavements' },
  { id: 'drainage',   name: 'Drainage & Water' },
  { id: 'lighting',   name: 'Street Lighting' },
  { id: 'sanitation', name: 'Sanitation & Parks' },
];
export const STATUSES = ['new', 'assigned', 'in_progress', 'awaiting_verification', 'closed'];
