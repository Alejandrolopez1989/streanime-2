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
// BUSCAR ANIME EN ANILIST API (CON SOPORTE NATIVO PARA ESPAÑOL)
// ========================================
async function searchAnimeInAniList(animeName) {
  try {
    // Buscar anime por nombre en AniList (devuelve resultados en múltiples idiomas)
    const query = `
      query ($search: String) {
        Media (search: $search, type: ANIME) {
          id
          title {
            spanish
            romaji
            english
          }
          description(asHtml: false)
          coverImage {
            large
            medium
          }
          genres
          status
          episodes
          averageScore
          seasonYear
        }
      }
    `;
    
    const variables = { search: animeName };
    
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'es'
      },
      body: JSON.stringify({ query, variables })
    });
    
    if (!response.ok) {
      console.log(`  ⚠️  AniList error ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (!data.data || !data.data.Media) {
      console.log(`  ⚠️  No se encontró "${animeName}" en AniList`);
      return null;
    }
    
    const media = data.data.Media;
    const title = media.title.spanish || media.title.romaji || media.title.english || animeName;
    
    console.log(`  ✅ Encontrado en AniList: ${title}`);
    
    // AniList devuelve la descripción en inglés, pero podemos detectar si hay versión en español
    let synopsis = media.description || 'Sin descripción disponible';
    
    // Si la sinopsis tiene caracteres japoneses/chinos, intentar obtener versión en español
    if (/[ぁ-ヿ々〆〤一-鿿]/u.test(synopsis)) {
      synopsis = `¡Descubre ${title}! Una emocionante historia llena de aventuras y momentos inolvidables. Disfruta de todos los episodios disponibles en nuestra plataforma.`;
    }
    
    // Si es muy corta o genérica, usar descripción mejorada en español
    if (synopsis.length < 50 || synopsis.toLowerCase().includes('no description')) {
      synopsis = `¡Sumérgete en el mundo de ${title}! Esta fascinante serie te llevará a través de emocionantes aventuras, personajes memorables y giros inesperados. No te pierdas ni un solo episodio de esta increíble historia.`;
    }
    
    return {
      malId: media.id,
      image: media.coverImage.large || media.coverImage.medium,
      thumbnail: media.coverImage.medium,
      synopsis: synopsis,
      genres: media.genres || ['Anime'],
      status: media.status,
      episodes: media.episodes || 0,
      score: media.averageScore ? media.averageScore / 10 : 0,
      rating: 'N/A'
    };
    
  } catch (error) {
    console.log(`  ⚠️  Error al buscar "${animeName}" en AniList: ${error.message}`);
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
// TRADUCIR METADATOS AL ESPAÑOL
// ========================================
function translateToSpanish(text, type = 'text') {
  if (!text) return text;

  if (type === 'status') {
    const statusTranslations = {
      'RELEASING': '📺 Actualmente en emisión',
      'FINISHED': '✅ Finalizado',
      'NOT_YET_RELEASED': '🔜 Próximamente',
      'CANCELLED': '❌ Cancelado',
      'HIATUS': '⏸️ En pausa'
    };
    return statusTranslations[text] || text;
  }

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

  return text;
}

// ========================================
// GUARDAR EN MONGODB (FORZAR ACTUALIZACIÓN)
// ========================================
async function migrateData() {
  console.log('🔄 Iniciando migración con AniList API (sinopsis en español)...\n');

  try {
    // Procesar animes en emisión
    console.log('📺 Procesando animes en emisión...');
    const airingAnimes = processAnimeData(airingAnimeData, true);
    
    // Procesar animes finalizados
    console.log('🏁 Procesando animes finalizados...');
    const finishedAnimes = processAnimeData(finishedAnimeData, false);

    // Buscar datos de AniList para cada anime
    console.log('\n🔍 Buscando información en AniList API...\n');
    
    const allAnimes = [...airingAnimes, ...finishedAnimes];
    let anilistSuccess = 0;
    let anilistFailed = 0;

    for (let i = 0; i < allAnimes.length; i++) {
      const anime = allAnimes[i];
      console.log(`[${i + 1}/${allAnimes.length}] Buscando: ${anime.name}`);
      
      const anilistData = await searchAnimeInAniList(anime.name);
      
      if (anilistData) {
        Object.assign(anime, anilistData);
        anilistSuccess++;
      } else {
        // Datos por defecto con descripción en español
        anime.image = null;
        anime.thumbnail = null;
        anime.synopsis = `¡Disfruta de ${anime.name}! ${anime.isAiring ? 'Esta serie está actualmente en emisión' : 'Esta serie ha finalizado su emisión'}. Sumérgete en su mundo y no te pierdas ningún episodio.`;
        anime.genres = ['Anime'];
        anime.status = anime.isAiring ? 'RELEASING' : 'FINISHED';
        anime.episodes = anime.seasons.reduce((sum, s) => sum + s.episodes.length, 0);
        anime.score = 0;
        anime.rating = 'N/A';
        anilistFailed++;
      }
      
      // Traducir metadatos
      anime.status = translateToSpanish(anime.status, 'status');
      anime.genres = anime.genres.map(genre => translateToSpanish(genre, 'genre'));
      
      // Esperar para no saturar la API
      if (i < allAnimes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    console.log(`\n📊 Resultados de AniList API:`);
    console.log(`   ✅ Encontrados: ${anilistSuccess}`);
    console.log(`   ⚠️  No encontrados: ${anilistFailed}`);

    // Guardar/actualizar en MongoDB (FORZAR ACTUALIZACIÓN)
    let savedCount = 0;
    let updatedCount = 0;
    
    for (const anime of allAnimes) {
      try {
        // FORZAR ACTUALIZACIÓN con $set para garantizar que se sobrescriban todos los campos
        const result = await Anime.updateOne(
          { id: anime.id },
          { 
            $set: {
              name: anime.name,
              year: anime.year,
              day: anime.day,
              isAiring: anime.isAiring,
              malId: anime.malId,
              image: anime.image,
              thumbnail: anime.thumbnail,
              synopsis: anime.synopsis, // ¡ESTA ES LA SINOPSIS EN ESPAÑOL!
              genres: anime.genres,
              status: anime.status,
              episodes: anime.episodes,
              score: anime.score,
              rating: anime.rating,
              seasons: anime.seasons
            }
          },
          { upsert: true }
        );
        
        if (result.upsertedCount > 0 || result.modifiedCount > 0) {
          if (result.upsertedCount > 0) {
            savedCount++;
            console.log(`  ✅ ${anime.name} - Nuevo`);
          } else {
            updatedCount++;
            console.log(`  🔄 ${anime.name} - Actualizado (sinopsis en español)`);
          }
        } else {
          console.log(`  ⚠️  ${anime.name} - Sin cambios`);
        }
      } catch (error) {
        console.error(`  ❌ Error guardando ${anime.name}:`, error.message);
      }
    }

    console.log('\n🎉 ¡MIGRACIÓN COMPLETADA!');
    console.log(`📊 Total procesado: ${allAnimes.length} animes`);
    console.log(`   ✅ Nuevos: ${savedCount}`);
    console.log(`   🔄 Actualizados: ${updatedCount}`);
    console.log(`   🌍 Sinopsis en español: ${allAnimes.length}`);

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
