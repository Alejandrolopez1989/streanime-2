require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// CONEXIÓN A MONGODB ATLAS
// ========================================
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Conectado a MongoDB Atlas'))
.catch(err => console.error('❌ Error de conexión:', err));

// ========================================
// ESQUEMA DE DATOS
// ========================================
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
// MIDDLEWARES DE SEGURIDAD
// ========================================
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// ========================================
// GENERADOR DE TOKENS JWT
// ========================================
function generateStreamToken(episodeId) {
  return jwt.sign(
    { 
      episodeId, 
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + parseInt(process.env.TOKEN_EXPIRES || '300')
    },
    process.env.JWT_SECRET,
    { expiresIn: `${process.env.TOKEN_EXPIRES || 300}s` }
  );
}

// ========================================
// ENDPOINT 1: Obtener listado de animes
// ========================================
app.get('/api/animes/:type', async (req, res) => {
  try {
    const isAiring = req.params.type === 'airing';
    const animes = await Anime.find({ isAiring })
      .select('id name year day isAiring seasons.seasonNumber seasons.episodes.episodeNumber seasons.episodes.name seasons.episodes.fileName')
      .lean();
    
    const processed = animes.map(anime => ({
      id: anime.id,
      name: anime.name,
      year: anime.year,
      day: anime.day,
      isAiring: anime.isAiring,
      totalSeasons: anime.seasons.length,
      totalEpisodes: anime.seasons.reduce((sum, s) => sum + s.episodes.length, 0),
      seasons: anime.seasons.map(season => ({
        seasonNumber: season.seasonNumber,
        episodes: season.episodes.map(ep => ({
          episodeNumber: ep.episodeNumber,
          name: ep.name,
          fileName: ep.fileName
        }))
      }))
    }));
    
    res.json({ success: true,  processed });
  } catch (error) {
    console.error('Error al cargar animes:', error);
    res.status(500).json({ success: false, error: 'Error al cargar animes' });
  }
});

// ========================================
// ENDPOINT 2: Obtener token de streaming
// ========================================
app.post('/api/stream/token', (req, res) => {
  const { episodeId } = req.body;
  
  if (!episodeId) {
    return res.status(400).json({ success: false, error: 'ID de episodio requerido' });
  }
  
  try {
    const token = generateStreamToken(episodeId);
    res.json({ 
      success: true, 
      token, 
      expiresInSeconds: parseInt(process.env.TOKEN_EXPIRES || '300') 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al generar token' });
  }
});

// ========================================
// ENDPOINT 3: Obtener URL real (PROTEGIDO)
// ========================================
app.get('/api/stream/:episodeId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token requerido' });
    }
    
    // Verificar token JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(403).json({ success: false, error: 'Token inválido o expirado' });
    }
    
    // Buscar episodio
    const [animeId, seasonNum, episodeNum] = decoded.episodeId.split('-');
    const anime = await Anime.findOne({ id: animeId });
    
    if (!anime) {
      return res.status(404).json({ success: false, error: 'Anime no encontrado' });
    }
    
    const season = anime.seasons.find(s => s.seasonNumber.toString() === seasonNum);
    const episode = season?.episodes.find(e => e.episodeNumber.toString() === episodeNum);
    
    if (!episode) {
      return res.status(404).json({ success: false, error: 'Episodio no encontrado' });
    }
    
    // Devolver URL del video
    res.json({ 
      success: true, 
      videoUrl: episode.videoUrl,
      animeName: anime.name,
      episodeNumber: episode.episodeNumber
    });
    
  } catch (error) {
    console.error('Error en streaming:', error);
    res.status(500).json({ success: false, error: 'Error al procesar streaming' });
  }
});

// ========================================
// ENDPOINT 4: Health check
// ========================================
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'ok', 
    timestamp: new Date().toISOString() 
  });
});

app.listen(PORT, () => {
  console.log(`🛡️  Servidor corriendo en puerto ${PORT}`);
});

module.exports = app;