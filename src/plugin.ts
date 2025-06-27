import {
    KazagumoPlugin as Plugin,
    Kazagumo,
    KazagumoTrack,
    KazagumoError,
} from "kazagumo";
import axios from "axios";

type AppleOptions = {
    countryCode?: string;
    credentials?: string;
    imageWidth?: number;
    imageHeight?: number;
};

export class KazagumoPlugin extends Plugin {
    options: AppleOptions;
    private _search: Kazagumo["search"] | null = null;
    private kazagumo: Kazagumo | null = null;
    private credentials: Record<string, string>;
    private readonly methods: Record<string, Function>;
    private fetchURL: string;
    private baseURL: string;
    countryCode: string;
    imageWidth: number;
    imageHeight: number;

    constructor(appleOptions: AppleOptions) {
        super();
        this.options = appleOptions;
        this.countryCode = appleOptions?.countryCode ?? "us";
        this.imageWidth = appleOptions?.imageWidth ?? 600;
        this.imageHeight = appleOptions?.imageHeight ?? 900;

        this.methods = {
            artist: this.getArtist.bind(this),
            album: this.getAlbum.bind(this),
            playlist: this.getPlaylist.bind(this),
            track: this.getTrack.bind(this),
        };

        this.baseURL = "https://api.music.apple.com/v1/";
        this.fetchURL = `https://amp-api.music.apple.com/v1/catalog/${this.countryCode}`;
        this.credentials = {
            Authorization: `Bearer ${appleOptions?.credentials ?? ""}`,
            origin: "https://music.apple.com",
        };
    }

    load(kazagumo: Kazagumo): void {
        this.kazagumo = kazagumo;
        this._search = kazagumo.search.bind(kazagumo);
        kazagumo.search = this.search.bind(this);
    }

    async getData(params: string): Promise<any> {
        const req = await axios.get(`${this.fetchURL}${params}`, {
            headers: this.credentials,
        });
        return req.data;
    }

    async search(query: string, options?: any): Promise<any> {
        const REGEX = /(?:https:\/\/music\.apple\.com\/)(?:.+)?(artist|album|music-video|playlist)\/([\w\-\.]+(\/)+[\w\-\.]+|[^&]+)\/([\w\-\.]+(\/)+[\w\-\.]+|[^&]+)/;
        const REGEX_SONG_ONLY = /(?:https:\/\/music\.apple\.com\/)(?:.+)?(artist|album|music-video|playlist)\/([\w\-\.]+(\/)+[\w\-\.]+|[^&]+)\/([\w\-\.]+(\/)+[\w\-\.]+|[^&]+)(\?|\&)([^=]+)\=([\w\-\.]+(\/)+[\w\-\.]+|[^&]+)/;

        if (!this.kazagumo || !this._search) {
            throw new KazagumoError(1, "kazagumo-apple is not loaded yet.");
        }

        if (!query) {
            throw new KazagumoError(3, "Query is required");
        }

        let type: string | undefined;
        let id: string | undefined;
        let is_track = false;

        if (!REGEX_SONG_ONLY.exec(query)) {
            const extract = REGEX.exec(query) || [];
            id = extract[4];
            type = extract[1];
        } else {
            const extract = REGEX_SONG_ONLY.exec(query) || [];
            id = extract[8];
            type = extract[1];
            is_track = true;
        }

        const isUrl = /^https?:\/\//.test(query);
        if (type && this.methods[type]) {
            try {
                let _function = is_track ? this.methods.track : this.methods[type];
                const result = await _function(id, options?.requester);
                const loadType = is_track ? "TRACK" : "PLAYLIST";
                const playlistName = result.name ?? undefined;
                const tracks = result.tracks.filter(this.filterNullOrUndefined);
                return this.buildSearch(playlistName, tracks, loadType);
            } catch (e) {
                return this.buildSearch(undefined, [], "SEARCH");
            }
        } else if (options?.engine === "apple" && !isUrl) {
            const result = await this.searchTrack(query, options?.requester);
            return this.buildSearch(undefined, result.tracks, "SEARCH");
        }

        return this._search(query, options);
    }

    private buildSearch(playlistName?: string, tracks: KazagumoTrack[] = [], type?: string): any {
        return {
            playlistName,
            tracks,
            type: type ?? "TRACK",
        };
    }

    private async searchTrack(query: string, requester?: any): Promise<Result> {
        try {
            const res = await this.getData(
                `/search?types=songs&term=${query.replace(/ /g, "+").toLocaleLowerCase()}`
            );
            return {
                tracks: res.results.songs.data.map((track: any) =>
                    this.buildKazagumoTrack(track, requester)
                ),
            };
        } catch (e) {
            throw new Error(e as any);
        }
    }

    private async getTrack(id: string, requester?: any): Promise<Result> {
        try {
            const track = await this.getData(`/songs/${id}`);
            return { tracks: [this.buildKazagumoTrack(track.data[0], requester)] };
        } catch (e) {
            throw new Error(e as any);
        }
    }

    private async getArtist(id: string, requester?: any): Promise<Result> {
        try {
            const track = await this.getData(`/artists/${id}/view/top-songs`);
            return { tracks: [this.buildKazagumoTrack(track.data[0], requester)] };
        } catch (e) {
            throw new Error(e as any);
        }
    }

    private async getAlbum(id: string, requester?: any): Promise<Result> {
        try {
            const album = await this.getData(`/albums/${id}`);
            const tracks = album.data[0].relationships.tracks.data
                .filter(this.filterNullOrUndefined)
                .map((track: any) => this.buildKazagumoTrack(track, requester));
            return { tracks, name: album.data[0].attributes.name };
        } catch (e) {
            throw new Error(e as any);
        }
    }

    private async getPlaylist(id: string, requester?: any): Promise<Result> {
        try {
            const playlist = await this.getData(`/playlists/${id}`);
            const tracks = playlist.data[0].relationships.tracks.data
                .filter(this.filterNullOrUndefined)
                .map((track: any) => this.buildKazagumoTrack(track, requester));
            return { tracks, name: playlist.data[0].attributes.name };
        } catch (e) {
            throw new Error(e as any);
        }
    }

    private filterNullOrUndefined(obj: any): boolean {
        return obj !== undefined && obj !== null;
    }

    private buildKazagumoTrack(appleTrack: Track, requester: any): KazagumoTrack {
        const artworkURL = String(appleTrack.attributes.artwork.url)
            .replace("{w}", String(this.imageWidth))
            .replace("{h}", String(this.imageHeight));

        return new KazagumoTrack(
            {
                encoded: "",
                info: {
                    sourceName: "apple",
                    identifier: appleTrack.id,
                    isSeekable: true,
                    author: appleTrack.attributes.artistName ?? "Unknown",
                    length: appleTrack.attributes.durationInMillis,
                    isStream: false,
                    position: 0,
                    title: appleTrack.attributes.name,
                    uri: appleTrack.attributes.url || "",
                    artworkUrl: artworkURL,
                },
                pluginInfo: null,
            },
            requester
        );
    }
}

export interface Result {
    tracks: KazagumoTrack[];
    name?: string;
}

export interface Track {
    id: string;
    type: string;
    href: string;
    attributes: TrackAttributes;
}

export interface TrackAttributes {
    albumName: string;
    hasTimeSyncedLyrics: boolean;
    genreNames: any[];
    trackNumber: number;
    releaseDate: string;
    durationInMillis: number;
    isVocalAttenuationAllowed: boolean;
    isMasteredForItunes: boolean;
    isrc: string;
    artwork: Record<string, any>;
    audioLocale: string;
    composerName: string;
    url: string;
    playParams: Record<string, any>;
    discNumber: number;
    hasCredits: boolean;
    hasLyrics: boolean;
    isAppleDigitalMaster: boolean;
    audioTraits: any[];
    name: string;
    previews: any[];
    artistName: string;
}
