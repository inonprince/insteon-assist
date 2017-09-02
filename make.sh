docker build --tag insteon-assist . && docker run -d --name=insteon-assist --net host -v /home/docker/insteon-assist:/data --restart unless-stopped insteon-assist
