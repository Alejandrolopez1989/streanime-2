require('dotenv').config();
const mongoose = require('mongoose');
const { airingAnimeData, finishedAnimeData } = require('./data.js');

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
});

const animeSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: String,
  year: Number,
  day: String,
  isAiring: Boolean,
  seasons: [{
    seasonNumber: Number,
    episodes: [{
      episodeNumber: Number,
      name: String,
      videoUrl: String,
      fileName: String
    }]
  }]
});

const Anime = mongoose.model('Anime', animeSchema);

// ========================================
// PROCESAR DATOS AUTOMÁTICAMENTE
// ========================================
function processAnimeData(data, isAiring = false) {
  const lines = data.trim().split('\n');
  const animeMap = {};
  let currentAnime = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    // Detectar título del anime
    let titleMatch;
    if (isAiring) {
      titleMatch = line.match(/^(.+?)\s+(\d{4})(?:\s+\(([^)]+)\))?$/);
    } else {
      titleMatch = line.match(/^(.+?)\s+(\d{4})$/);
    }

    if (titleMatch) {
      // Es un título de anime
      const animeName = titleMatch[1].trim();
      const year = parseInt(titleMatch[2]);
      const day = isAiring && titleMatch[3] ? titleMatch[3].trim() : null;

      // Crear ID único
      const id = animeName.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      // Crear anime
      currentAnime = {
        id: id,
        name: animeName,
        year: year,
        day: day,
        isAiring: isAiring,
        seasons: {}
      };
      animeMap[id] = currentAnime;
    } else if (currentAnime && line.includes('|')) {
      // Es una línea de episodio
      const episodeMatch = line.match(/^(.*?)\s+(\d+)x(\d+)(?:\.mp4)?\|(.+)$/);
      
      if (episodeMatch) {
        const seasonNum = parseInt(episodeMatch[2]);
        const episodeNum = parseInt(episodeMatch[3]);
        const url = episodeMatch[4].trim(); // URL original

        // Crear temporada si no existe
        if (!currentAnime.seasons[seasonNum]) {
          currentAnime.seasons[seasonNum] = {
            seasonNumber: seasonNum,
            episodes: []
          };
        }

        // Agregar episodio con URL original
        currentAnime.seasons[seasonNum].episodes.push({
          episodeNumber: episodeNum,
          name: `Episodio ${episodeNum}`,
          videoUrl: url, // ✅ URL original directamente
          fileName: `${seasonNum}x${episodeNum.toString().padStart(2, '0')}.mp4`
        });
      }
    }
  }

  // Convertir a array y ordenar
  const animeArray = Object.values(animeMap);
  
  animeArray.forEach(anime => {
    const seasonsArray = Object.values(anime.seasons);
    seasonsArray.sort((a, b) => a.seasonNumber - b.seasonNumber);
    seasonsArray.forEach(season => {
      season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
    });
    anime.seasons = seasonsArray;
  });

  return animeArray;
}

// ========================================
// GUARDAR EN MONGODB
// ========================================
async function migrateData() {
  console.log('🔄 Iniciando migración automática...\n');

  try {
    // Procesar animes en emisión
    console.log('📺 Procesando animes en emisión...');
    const airingAnimes = processAnimeData(airingAnimeData, true);
    
    // Procesar animes finalizados
    console.log('🏁 Procesando animes finalizados...');
    const finishedAnimes = processAnimeData(finishedAnimeData, false);

    // Guardar en MongoDB
    let savedCount = 0;
    let updatedCount = 0;
    
    // Guardar animes en emisión
    for (const anime of airingAnimes) {
      const existing = await Anime.findOne({ id: anime.id });
      
      if (existing) {
        await Anime.updateOne({ id: anime.id }, anime);
        updatedCount++;
        console.log(`  🔄 ${anime.name} - Actualizado (${anime.totalEpisodes || anime.seasons.reduce((sum, s) => sum + s.episodes.length, 0)} episodios)`);
      } else {
        await Anime.create(anime);
        savedCount++;
        console.log(`  ✅ ${anime.name} - Nuevo (${anime.totalEpisodes || anime.seasons.reduce((sum, s) => sum + s.episodes.length, 0)} episodios)`);
      }
    }

    // Guardar animes finalizados
    for (const anime of finishedAnimes) {
      const existing = await Anime.findOne({ id: anime.id });
      
      if (existing) {
        await Anime.updateOne({ id: anime.id }, anime);
        updatedCount++;
        console.log(`  🔄 ${anime.name} - Actualizado (${anime.totalEpisodes || anime.seasons.reduce((sum, s) => sum + s.episodes.length, 0)} episodios)`);
      } else {
        await Anime.create(anime);
        savedCount++;
        console.log(`  ✅ ${anime.name} - Nuevo (${anime.totalEpisodes || anime.seasons.reduce((sum, s) => sum + s.episodes.length, 0)} episodios)`);
      }
    }

    console.log('\n🎉 ¡MIGRACIÓN COMPLETADA!');
    console.log(`📊 Total procesado: ${airingAnimes.length + finishedAnimes.length} animes`);
    console.log(`   ✅ Nuevos: ${savedCount}`);
    console.log(`   🔄 Actualizados: ${updatedCount}`);

    // Verificar en base de datos
    const totalInDB = await Anime.countDocuments();
    console.log(`📊 Total en MongoDB: ${totalInDB} animes`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error en la migración:', error);
    process.exit(1);
  }
}

// Ejecutar migración
migrateData();
