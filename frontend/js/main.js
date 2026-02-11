// ========================================
// RENDERIZAR EPISODIOS (MODIFICADO)
// ========================================
function renderEpisodes(season, seasonId, anime) {
    const episodesGrid = document.getElementById(seasonId);
    if (!episodesGrid) return;

    season.episodes.forEach(episode => {
        const episodeCard = document.createElement('div');
        episodeCard.className = 'episode-card';
        
        // Agregar datos para el player
        episodeCard.dataset.animeName = anime.name;
        episodeCard.dataset.episodeNum = episode.episodeNumber;
        episodeCard.dataset.seasonNum = season.seasonNumber;
        episodeCard.dataset.animeId = anime.id;
        
        episodeCard.innerHTML = `
            <div class="episode-poster">
                <div class="episode-number">${episode.episodeNumber}</div>
                <div class="episode-play-overlay">
                    <i class="fas fa-play"></i>
                </div>
            </div>
            <div class="episode-info">
                <div class="episode-title-full">${anime.name} - Episodio ${episode.episodeNumber}</div>
                <div class="episode-meta">
                    <span class="episode-duration"><i class="far fa-clock"></i> 24 min</span>
                    <span class="episode-file">${episode.fileName}</span>
                </div>
            </div>
        `;
        
        episodesGrid.appendChild(episodeCard);
    });
}