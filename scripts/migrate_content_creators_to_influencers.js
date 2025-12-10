// Migration script: copy documents from 'content_creators' to 'influencers'
// Also copies 'stats' subcollection if present

const { db } = require('../config/firebase');

async function copySubcollection(fromDocRef, toDocRef, subcollectionName) {
  const subRef = fromDocRef.collection(subcollectionName);
  const snapshot = await subRef.get();
  if (snapshot.empty) return;

  const batch = db.batch();
  snapshot.forEach(doc => {
    const toRef = toDocRef.collection(subcollectionName).doc(doc.id);
    batch.set(toRef, doc.data(), { merge: true });
  });
  await batch.commit();
}

async function migrate() {
  console.log('Starting migration: content_creators -> influencers');
  const fromCollection = db.collection('content_creators');
  const toCollection = db.collection('influencers');

  const snapshot = await fromCollection.get();
  if (snapshot.empty) {
    console.log("No 'content_creators' documents found. Nothing to migrate.");
    return;
  }

  let migratedCount = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Optionally normalize any role field back to 'influencer'
    if (data.role && data.role !== 'influencer') {
      data.role = 'influencer';
    }

    const toDocRef = toCollection.doc(doc.id);
    await toDocRef.set(data, { merge: true });

    // Copy known subcollections
    await copySubcollection(doc.ref, toDocRef, 'stats');

    migratedCount++;
    console.log(`Migrated doc ${doc.id}`);
  }

  console.log(`Migration complete. Migrated ${migratedCount} documents.`);
}

migrate().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});