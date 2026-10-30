DEVICE ?= tv
APP_ID = io.strem.tv
SERVER_VERSION = 4.20.17
VIDAA_REF = 208d437e5138adff0865443a2a88c4fcee84ece6
VIDAA_REPO = https://github.com/NoobyGains/stremio-vidaa-tv/archive/$(VIDAA_REF).tar.gz
FFMPEG_VERSION = 7.0.2
FFMPEG_URL = https://johnvansickle.com/ffmpeg/releases/ffmpeg-$(FFMPEG_VERSION)-arm64-static.tar.xz
FFMPEG_SHA256 = f4149bb2b0784e30e99bdda85471c9b5930d3402014e934a5098b41d0f7201b1
VERSION = $(shell python3 -c "import json; print(json.load(open('app/appinfo.json'))['version'])")
IPK = $(APP_ID)_$(VERSION)_all.ipk

.PHONY: build package deploy launch restart clean

service/server.js:
	@echo "==> Downloading Stremio server v$(SERVER_VERSION)..."
	@curl -so $@ "https://dl.strem.io/server/v$(SERVER_VERSION)/webos/server.js"

service/bin/ffmpeg service/bin/ffprobe:
	@echo "==> Downloading static ffmpeg+ffprobe v$(FFMPEG_VERSION) (aarch64)..."
	@rm -rf /tmp/stremio-ffmpeg && mkdir -p /tmp/stremio-ffmpeg service/bin
	@curl -sLo /tmp/stremio-ffmpeg/ffmpeg.tar.xz $(FFMPEG_URL)
	@echo "$(FFMPEG_SHA256)  /tmp/stremio-ffmpeg/ffmpeg.tar.xz" | shasum -a 256 -c -
	@tar xJ --strip-components=1 -f /tmp/stremio-ffmpeg/ffmpeg.tar.xz -C /tmp/stremio-ffmpeg
	@cp /tmp/stremio-ffmpeg/ffmpeg /tmp/stremio-ffmpeg/ffprobe service/bin/
	@chmod +x service/bin/ffmpeg service/bin/ffprobe
	@rm -rf /tmp/stremio-ffmpeg

build: service/server.js service/bin/ffmpeg service/bin/ffprobe
	@echo "==> Downloading Vidaa frontend..."
	@rm -rf /tmp/stremio-vidaa-build && mkdir -p /tmp/stremio-vidaa-build
	@curl -sL $(VIDAA_REPO) | tar xz --strip-components=1 -C /tmp/stremio-vidaa-build
	@echo "==> Building service/www/..."
	@rm -rf service/www && mkdir -p service/www
	@cp /tmp/stremio-vidaa-build/*.js /tmp/stremio-vidaa-build/*.wasm /tmp/stremio-vidaa-build/*.ttf /tmp/stremio-vidaa-build/*.png /tmp/stremio-vidaa-build/*.svg service/www/
	@cp service/index.html service/www/index.html
	@rm -rf /tmp/stremio-vidaa-build
	@for p in patches/*.patch; do \
		echo "    Applying $$(basename $$p)..."; \
		patch -p0 -d service/www < "$$p"; \
	done
	@echo "==> Build complete"

package: build
	@rm -f $(IPK)
	@ares-package --no-minify app service -o .
	@python3 scripts/check-ipk.py $(IPK)

deploy: package
	@for i in 1 2 3 4 5; do \
		ares-install --device $(DEVICE) $(IPK) && break || sleep 3; \
	done
	@ares-launch --device $(DEVICE) $(APP_ID)

launch:
	@ares-launch --device $(DEVICE) $(APP_ID)

restart:
	@-ares-launch --device $(DEVICE) --close $(APP_ID)
	@sleep 1
	@ares-launch --device $(DEVICE) $(APP_ID)

clean:
	rm -rf service/www service/server.js service/bin *.ipk
