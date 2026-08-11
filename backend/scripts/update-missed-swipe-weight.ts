import prisma from '../src/db/prisma';

async function updateMissedSwipeWeight() {
  try {
    await prisma.setting.upsert({
      where: { key: 'missed_swipe_weight' },
      update: { value: '0' },
      create: { key: 'missed_swipe_weight', value: '0' },
    });
    console.log('✅ Updated missed_swipe_weight to 0');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating setting:', error);
    process.exit(1);
  }
}

updateMissedSwipeWeight();
