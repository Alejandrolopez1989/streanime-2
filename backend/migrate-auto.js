require('dotenv').config();
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const { airingAnimeData, finishedAnimeData } = require('./data.js');

// ========================================
// CONEXIÓN A MONGODB
// ========================================
mongoose.connect(process.env.MONGODB_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
}).then(() => {
  console.log('✅ Conectado a MongoDB Atlas');
}).catch(err => {
  console.error('❌ Error de conexión:', err);
});

const animeSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: String,
  year: Number,
  day: String,
  isAiring: Boolean,
  malId: Number,
  image: String,
  thumbnail: String,
  synopsis: String,
  genres: [String],
  status: String,
  episodes: Number,
  score: Number,
  rating: String,
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
// BUSCAR ANIME EN JIKAN API (CON SOPORTE PARA ESPAÑOL)
// ========================================
async function searchAnimeInJikan(animeName) {
  try {
    // Buscar anime por nombre - SOLICITAR ESPAÑOL DIRECTAMENTE
    const searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(animeName)}&limit=1`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'Accept-Language': 'es-ES', // ¡ESTO ES CLAVE! Solicita datos en español
        'User-Agent': 'Mozilla/5.0' // Evitar bloqueos
      }
    });
    
    if (!searchRes.ok) {
      console.log(`  ⚠️  No se encontró "${animeName}" en Jikan (status: ${searchRes.status})`);
      return null;
    }
    
    const searchData = await searchRes.json();
    
    if (!searchData.data || searchData.data.length === 0) {
      console.log(`  ⚠️  No se encontró "${animeName}" en Jikan`);
      return null;
    }
    
    // Obtener el primer resultado - YA VIENE EN ESPAÑOL
    const animeData = searchData.data[0];
    
    console.log(`  ✅ Encontrado en Jikan (ES): ${animeData.title}`);
    
    return {
      malId: animeData.mal_id,
      image: animeData.images.jpg.large_image_url || animeData.images.jpg.image_url,
      thumbnail: animeData.images.jpg.image_url,
      // ¡LA SINOPSIS YA VIENE EN ESPAÑOL!
      synopsis: animeData.synopsis || 'Sin descripción disponible',
      // Los géneros vienen en inglés, los traduciremos después
      genres: animeData.genres.map(g => g.name),
      // El status viene en inglés, lo traduciremos después
      status: animeData.status,
      episodes: animeData.episodes || 0,
      score: animeData.score || 0,
      rating: animeData.rating || 'N/A'
    };
    
  } catch (error) {
    console.log(`  ⚠️  Error al buscar "${animeName}" en Jikan: ${error.message}`);
    return null;
  }
}

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
        const url = episodeMatch[4].trim();

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
          videoUrl: url,
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
// TRADUCIR METADATOS AL ESPAÑOL (SOLO PARA STATUS, GÉNEROS Y RATING)
// ========================================
function translateToSpanish(text, type = 'text') {
  if (!text) return text;

  // Traducciones predefinidas para status
  if (type === 'status') {
    const statusTranslations = {
      'Currently Airing': '📺 Actualmente en emisión',
      'Finished Airing': '✅ Finalizado',
      'Not yet aired': '🔜 Próximamente',
      'Cancelled': '❌ Cancelado',
      'Hiatus': '⏸️ En pausa'
    };
    return statusTranslations[text] || text;
  }

  // Traducciones predefinidas para géneros
  if (type === 'genre') {
    const genreTranslations = {
      'Action': 'Acción',
      'Adventure': 'Aventura',
      'Comedy': 'Comedia',
      'Drama': 'Drama',
      'Ecchi': 'Ecchi',
      'Fantasy': 'Fantasía',
      'Horror': 'Terror',
      'Mahou Shoujo': 'Magia',
      'Mecha': 'Mecha',
      'Music': 'Música',
      'Mystery': 'Misterio',
      'Psychological': 'Psicológico',
      'Romance': 'Romance',
      'Sci-Fi': 'Ciencia Ficción',
      'Slice of Life': 'Vida Cotidiana',
      'Sports': 'Deportes',
      'Supernatural': 'Sobrenatural',
      'Thriller': 'Thriller',
      'Hentai': 'Hentai',
      'Isekai': 'Isekai',
      'Seinen': 'Seinen',
      'Shoujo': 'Shoujo',
      'Shounen': 'Shounen',
      'Josei': 'Josei',
      'Anime': 'Anime'
    };
    return genreTranslations[text] || text;
  }

  // Traducciones predefinidas para rating
  if (type === 'rating') {
    const ratingTranslations = {
      'G - All Ages': 'G - Para todas las edades',
      'PG - Children': 'PG - Para niños',
      'PG-13 - Teens 13 or older': 'PG-13 - Mayores de 13 años',
      'R - 17+ (violence & profanity)': 'R - Mayores de 17 años',
      'R+ - Mild Nudity': 'R+ - Nudidad leve',
      'Rx - Hentai': 'Rx - Hentai'
    };
    return ratingTranslations[text] || text;
  }

  return text; // Para otros tipos, devolver sin cambios
}

// ========================================
// GUARDAR EN MONGODB CON DATOS DE JIKAN EN ESPAÑOL
// ========================================
async function migrateData() {
  console.log('🔄 Iniciando migración con datos de Jikan API en español...\n');

  try {
    // Procesar animes en emisión
    console.log('📺 Procesando animes en emisión...');
    const airingAnimes = processAnimeData(airingAnimeData, true);
    
    // Procesar animes finalizados
    console.log('🏁 Procesando animes finalizados...');
    const finishedAnimes = processAnimeData(finishedAnimeData, false);

    // Buscar datos de Jikan para cada anime
    console.log('\n🔍 Buscando información en Jikan API (ES)...\n');
    
    const allAnimes = [...airingAnimes, ...finishedAnimes];
    let jikanSuccess = 0;
    let jikanFailed = 0;

    for (let i = 0; i < allAnimes.length; i++) {
      const anime = allAnimes[i];
      console.log(`[${i + 1}/${allAnimes.length}] Buscando: ${anime.name}`);
      
      const jikanData = await searchAnimeInJikan(anime.name);
      
      if (jikanData) {
        Object.assign(anime, jikanData);
        jikanSuccess++;
      } else {
        // Datos por defecto si no se encuentra en Jikan
        anime.image = null;
        anime.thumbnail = null;
        anime.synopsis = `${anime.name} es ${anime.isAiring ? 'un anime actualmente en emisión' : 'un anime que ha finalizado su emisión'}. Disfruta de todos los episodios disponibles.`;
        anime.genres = ['Anime'];
        anime.status = anime.isAiring ? 'Currently Airing' : 'Finished Airing';
        anime.episodes = anime.seasons.reduce((sum, s) => sum + s.episodes.length, 0);
        anime.score = 0;
        anime.rating = 'N/A';
        jikanFailed++;
      }
      
      // Esperar 1 segundo entre solicitudes para no saturar la API
      if (i < allAnimes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n📊 Resultados de Jikan API:`);
    console.log(`   ✅ Encontrados: ${jikanSuccess}`);
    console.log(`   ⚠️  No encontrados: ${jikanFailed}`);

    // Traducir status, géneros y rating (la sinopsis YA VIENE en español de Jikan)
    console.log('\n🌍 Traduciendo metadatos al español...\n');

    for (let i = 0; i < allAnimes.length; i++) {
      const anime = allAnimes[i];
      console.log(`[${i + 1}/${allAnimes.length}] Procesando: ${anime.name}`);
      
      // Status, géneros y rating vienen en inglés - traducir con diccionario
      anime.status = translateToSpanish(anime.status, 'status');
      anime.genres = anime.genres.map(genre => translateToSpanish(genre, 'genre'));
      anime.rating = translateToSpanish(anime.rating, 'rating');
      
      // ¡LA SINOPSIS YA ESTÁ EN ESPAÑOL! No traducir
      if (!anime.synopsis || anime.synopsis === 'Sin descripción disponible') {
        anime.synopsis = `${anime.name} es ${anime.isAiring ? 'un anime actualmente en emisión' : 'un anime que ha finalizado su emisión'}. Disfruta de todos los episodios disponibles en nuestra plataforma.`;
      }
    }

    // Guardar en MongoDB
    let savedCount = 0;
    let updatedCount = 0;
    
    for (const anime of allAnimes) {
      const existing = await Anime.findOne({ id: anime.id });
      
      if (existing) {
        await Anime.updateOne({ id: anime.id }, anime);
        updatedCount++;
        console.log(`  🔄 ${anime.name} - Actualizado`);
      } else {
        await Anime.create(anime);
        savedCount++;
        console.log(`  ✅ ${anime.name} - Nuevo`);
      }
    }

    console.log('\n🎉 ¡MIGRACIÓN COMPLETADA!');
    console.log(`📊 Total procesado: ${allAnimes.length} animes`);
    console.log(`   ✅ Nuevos: ${savedCount}`);
    console.log(`   🔄 Actualizados: ${updatedCount}`);
    console.log(`   🎨 Con datos de Jikan: ${jikanSuccess}`);
    console.log(`   🌍 Sinopsis en español: ${jikanSuccess} (directo de MyAnimeList)`);
    console.log(`   📝 Metadatos traducidos: ${allAnimes.length}`);

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
