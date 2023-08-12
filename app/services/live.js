import Service from '@ember/service';
import {
  HMSReactiveStore,
  selectIsSomeoneScreenSharing,
  selectPeers,
  selectIsConnectedToRoom,
  selectLocalPeer,
} from '@100mslive/hms-video-store';
import { tracked } from '@glimmer/tracking';
import ENV from 'website-www/config/environment';
import { globalRef } from 'ember-ref-bucket';
import { inject as service } from '@ember/service';
import {
  ROLES,
  PATCH_API_CONFIGS,
  POST_API_CONFIGS,
  GET_API_CONFIGS,
} from '../constants/live';
import { TOAST_OPTIONS } from '../constants/toast-options';
export default class LiveService extends Service {
  @service toast;
  hmsManager;
  hmsStore;
  hmsActions;
  @tracked isScreenShareOn = false;
  @tracked isJoined = false;
  @tracked activeRoomId = '';
  @tracked isLoading = false;
  @tracked localPeer;
  @globalRef('videoEl') videoEl;
  @tracked peers;
  @tracked isScreenShareOn;
  @tracked roomCodeForMaven = '';

  constructor() {
    super(...arguments);
    // Initialize HMS store
    this.hmsManager = new HMSReactiveStore();
    this.hmsManager.triggerOnSubscribe();
    this.hmsStore = this.hmsManager.getStore();
    this.hmsActions = this.hmsManager.getActions();
    this.hmsNotifications = this.hmsManager.notifications;
    this.hmsStore.subscribe(
      (peers) => this.renderScreenVideoToPeers(peers, this.hmsActions),
      selectPeers
    );
    this.hmsStore.subscribe(
      (isConnected) => this.onConnection(isConnected),
      selectIsConnectedToRoom
    );
  }

  onConnection(isConnected) {
    this.isJoined = isConnected;
    if (isConnected) {
      this.isLoading = false;
    }
  }

  async joinRoom(roomId, role, userName) {
    try {
      const response = await fetch(`${ENV.BASE_API_URL}/events/join`, {
        ...POST_API_CONFIGS,
        body: JSON.stringify({
          roomId,
          role,
          userId: userName,
        }),
      });
      const { token } = await response.json();
      return token;
    } catch (error) {
      console.error(error);
      this.toast.error('Something went wrong!', 'error!', TOAST_OPTIONS);
    }
  }

  async createRoom(userName) {
    try {
      const response = await fetch(`${ENV.BASE_API_URL}/events`, {
        ...POST_API_CONFIGS,
        body: JSON.stringify({
          name: `live-rds-${Math.random()}`,
          description: 'The RDS live',
          region: 'in',
          userId: userName,
        }),
      });
      const { room_id } = await response.json();
      return room_id;
    } catch (error) {
      console.error(error);
      this.toast.error('Something went wrong!', 'error!', TOAST_OPTIONS);
    }
  }

  async endRoom(roomId) {
    try {
      const response = await fetch(`${ENV.BASE_API_URL}/events/end`, {
        ...PATCH_API_CONFIGS,
        body: JSON.stringify({
          id: roomId,
          reason: 'Session is over',
          lock: true,
        }),
      });
      const { message } = await response.json();
      return message;
    } catch (error) {
      console.error(error);
      this.toast.error('Something went wrong!', 'error!', TOAST_OPTIONS);
    }
  }

  async getActiveRooms() {
    try {
      const response = await fetch(`${ENV.BASE_API_URL}/events?enabled=true`, {
        ...GET_API_CONFIGS,
      });
      const { data } = await response.json();
      return data;
    } catch (error) {
      console.error(error);
      this.toast.error('Something went wrong!', 'error!', TOAST_OPTIONS);
    }
  }

  async getRoomCodes(roomId) {
    try {
      const response = await fetch(
        `${ENV.BASE_API_URL}/events/roomCodes?room_id=${roomId}`,
        {
          ...GET_API_CONFIGS,
        }
      );
      const { data } = await response.json();
      return data;
    } catch (error) {
      console.error(error);
      this.toast.error('Something went wrong!', 'error!', TOAST_OPTIONS);
    }
  }

  async createRoomCodes(roomId) {
    try {
      const response = await fetch(`${ENV.BASE_API_URL}/events/roomCodes`, {
        ...POST_API_CONFIGS,
        body: JSON.stringify({
          room_id: roomId,
        }),
      });
      const { data } = await response.json();
      return data;
    } catch (error) {
      console.error(error);
      this.toast.error('Something went wrong!', 'error!', TOAST_OPTIONS);
    }
  }

  async addPeer(roomId, peer) {
    try {
      const response = await fetch(
        `${ENV.BASE_API_URL}/events/${roomId}/peers`,
        {
          ...POST_API_CONFIGS,
          body: JSON.stringify({
            peerId: peer?.id,
            name: peer?.name,
            role: peer?.roleName,
            joinedAt: peer?.joinedAt,
          }),
        }
      );
      console.log(response);
      const { data } = await response.json();
      return data;
    } catch (error) {
      console.error(error);
      this.toast.error('Something went wrong!', 'error!', TOAST_OPTIONS);
    }
  }

  async joinSession(userName, role, roomCode) {
    try {
      this.isLoading = true;
      const activeRooms = await this.getActiveRooms();
      let roomId;
      if (!activeRooms && ROLES.host === role) {
        roomId = await this.createRoom(userName);
        const roomCodes = await this.createRoomCodes(roomId);
        this.roomCodeForMaven = roomCodes?.find(
          (code) => code.role === ROLES.maven
        ).code;
      } else if (activeRooms?.length > 0) {
        roomId = activeRooms[0].room_id;
        if (role === ROLES.maven) {
          const roomCodes = await this.getRoomCodes(roomId);
          const mavenCode = roomCodes?.find(
            (code) => code.role === ROLES.maven
          ).code;
          const isValidCode = mavenCode === roomCode;
          if (!isValidCode) {
            this.toast.warning(
              'Incorrect room code',
              'Warning!',
              TOAST_OPTIONS
            );
            this.isLoading = false;
            return;
          }
        }
      } else {
        console.log('No active room');
        return;
      }
      this.activeRoomId = roomId;
      const token = await this.joinRoom(roomId, role, userName);
      await this.hmsActions.join({
        userName,
        authToken: token,
      });
      this.isLoading = false;
      const peer = this.hmsStore.getState(selectLocalPeer);
      this.localPeer = peer;
      const addedPeerData = await this.addPeer(roomId, peer);
      if (addedPeerData) {
        this.toast.success(
          'Successfully joined the event!',
          'Success!',
          TOAST_OPTIONS
        );
      }
    } catch (error) {
      this.isLoading = false;
      console.error(error);
      this.toast.error('Something went wrong!', 'Error!', TOAST_OPTIONS);
    }
  }

  async leaveSession(role) {
    try {
      if (ROLES.host === role) {
        this.isLoading = true;
        await this.endRoom(this.activeRoomId);
        this.isLoading = false;
      } else {
        await this.hmsActions.leave();
      }
    } catch (error) {
      this.isLoading = false;
      console.error(error);
    }
  }

  async shareScreen() {
    try {
      const screenShareOn = !this.hmsStore.getState(
        selectIsSomeoneScreenSharing
      );
      await this.hmsActions.setScreenShareEnabled(screenShareOn);
      this.isScreenShareOn = screenShareOn;
    } catch (error) {
      console.error(error);
    }
  }

  async renderScreenVideoToPeers(peers) {
    this.peers = peers;
    const presenterTrackId = peers?.find((p) => p.roleName === ROLES.host)
      ?.auxiliaryTracks[0];
    if (presenterTrackId) {
      this.isScreenShareOn = true;
      await this.hmsActions.attachVideo(presenterTrackId, this.videoEl);
    } else {
      await this.hmsActions.detachVideo(presenterTrackId, this.videoEl);
    }
  }

  async removePeer(peerId) {
    const roomId = this.hmsStore?.getState()?.room?.id;

    const reason = 'For doing something wrong!';
    try {
      const response = await fetch(
        `${ENV.BASE_API_URL}/events/${roomId}/peers/kickout`,
        {
          ...PATCH_API_CONFIGS,
          body: JSON.stringify({
            peerId: peerId,
            reason: reason,
          }),
        }
      );

      const data = await response.json();
      if (response.status === 200 && data) {
        this.toast.success(data?.message, 'Success!', TOAST_OPTIONS);
        return;
      }

      throw new Error(response);
    } catch (err) {
      console.error('The error is: ', err);
      this.toast.error('Something went wrong!', 'error!', TOAST_OPTIONS);
    }
  }
}