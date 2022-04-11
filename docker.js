const dockerode = require('dockerode');

class Docker {
    constructor(options) {
        this.logger = options.logger;
        this.docker = new dockerode();
        this.image = 'archwaynetwork/archwayd:latest';
        this.volume = 'vol_spinarch';
    }

    async image_exists(image_name) {
        const images = await this.docker.listImages();
        const _image_name = image_name || this.image;
        const image = images.find(function(image) {
            return image.RepoTags && image.RepoTags[0] === _image_name;
        });
        return !!image;
    }

    async pull_image(image_name) {
        const logger = this.logger;
        const docker = this.docker;
        const _image_name = image_name || this.image;

        this.logger.app(`Pulling image ${_image_name}...`);
        return new Promise(function(resolve, reject) {
            return docker.pull(_image_name, function(err, stream) {
                if (err) {
                    return reject(err);
                }

                stream.on('data', function(data) {
                    logger.docker(data.toString().trim());
                });

                stream.on('end', function() {
                    return resolve();
                });
            });
        });
    }

    async volume_exists() {
        const volume_name = this.volume;
        const out = await this.docker.listVolumes();
        const volume = out.Volumes.find(function(volume) {
            return volume.Name === volume_name;
        });

        return !!volume;
    }

    async remove_volume() {
        if (!(await this.volume_exists())) return;

        try {
            const volume = await this.docker.getVolume(this.volume);
            await volume.remove();
        } catch (err) {
            this.logger.docker(err);
        }
    }
}

module.exports = Docker;
