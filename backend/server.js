require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// LOGGING DE VARIABLES DE ENTORNO (para debugging)
// ========================================
console.log('🔍 Variables de entorno cargadas:');
console.log('  MONGODB_URI:', process.env.MONGODB_URI ? '✅ Configurado' : '❌ No configurado');
console.log('  JWT_SECRET:', process.env.JWT_SECRET ? `✅ Configurado (${process.env.JWT_SECRET.length} caracteres)` : '❌ No configurado');
console.log('  FRONTEND_URL:', process.env.FRONTEND_URL || 'No configurado');
console.log('  TOKEN_EXPIRES:', process.env.TOKEN_EXPIRES || '300');
console.log('  PORT:', process.env.PORT || 3000);

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
  try {
    // Verificar que JWT_SECRET esté definido
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      console.error('❌ JWT_SECRET no está configurado o es demasiado corto');
      throw new Error('JWT_SECRET no configurado correctamente');
    }
    
    // Verificar que episodeId esté definido
    if (!episodeId) {
      throw new Error('episodeId es requerido');
    }
    
    const expiresIn = parseInt(process.env.TOKEN_EXPIRES || '300');
    
    return jwt.sign(
      { 
        episodeId, 
        iat: Math.floor(Date.now() / 1000)
      },
      secret,
      { expiresIn: expiresIn }
    );
  } catch (error) {
    console.error('❌ Error al generar token JWT:', error.message);
    throw error;
  }
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
  try {
    const { episodeId } = req.body;
    
    if (!episodeId) {
      return res.status(400).json({ success: false, error: 'ID de episodio requerido' });
    }
    
    // Verificar JWT_SECRET
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET no está definido en las variables de entorno');
      return res.status(500).json({ success: false, error: 'Error de configuración del servidor' });
    }
    
    // Verificar longitud de JWT_SECRET
    if (process.env.JWT_SECRET.length < 32) {
      console.error('❌ JWT_SECRET es demasiado corto:', process.env.JWT_SECRET.length, 'caracteres');
      return res.status(500).json({ success: false, error: 'Error de configuración del servidor' });
    }
    
    // Generar token
    const token = generateStreamToken(episodeId);
    
    res.json({ 
      success: true, 
      token, 
      expiresInSeconds: parseInt(process.env.TOKEN_EXPIRES || '300') 
    });
  } catch (error) {
    console.error('❌ Error en /api/stream/token:', error);
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
